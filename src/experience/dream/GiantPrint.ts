import {
  BoxGeometry,
  CatmullRomCurve3,
  Group,
  HalfFloatType,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  PointLight,
  Ray,
  TubeGeometry,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Texture,
} from 'three';
import { LAYERS, photoConfig, REDUCED_MOTION, renderConfig } from '../../config/experience.config';
import { dreamConfig } from '../../config/dream.config';
import { ALLEY, LIGHT_COLORS } from '../../config/scene.config';
import { seaConfig } from '../../config/sea.config';
import { DEG, range, smootherstep } from '../math';
import { Photograph } from '../photograph/Photograph';
import { Grade } from '../render/Grade';

const G = dreamConfig.giantPrint;
const { print, image } = photoConfig;
/** Half the side of the giant print's image (m). */
const HALF = (image.size * G.scale) / 2;
/** Image center height above the print's center (m). */
const IMAGE_RISE = (print.height / 2 - image.offsetFromTop - image.size / 2) * G.scale;
/** The image must overlap every screen corner by this share of its half side before it counts as covering. */
const COVER_MARGIN = 0.02;
/** The window may be undersized by this many pixels around its screen bounds (soft edges of the scissor). */
const SCISSOR_PAD = 4;

const corner = new Vector3();
const hit = new Vector3();
const local = new Vector3();
const ray = new Ray();
const plane = new Plane();
const normal = new Vector3();
const offset = new Vector3(...seaConfig.offset);

/**
 * The print at the end of the alley, far too large, hanging from a wire like the small ones:
 * a photograph of the sea. From afar it is a still; closer, it is a live window into the sea
 * (the sea seen from exactly where you stand, moved by the sea's offset); once its image fills
 * the view, the sea itself is drawn instead — the same move that took you into the first photograph.
 */
export class GiantPrint {
  readonly root = new Group();
  readonly photo: Photograph;
  readonly stillRT = new WebGLRenderTarget(G.still.resolution, G.still.resolution, { type: HalfFloatType, samples: 2 });
  /** Center of the image (world), for attention and distances. */
  readonly imageCenter = new Vector3(G.center[0], G.center[1] + IMAGE_RISE, G.z);

  private readonly hanger = new Group();
  private sway = 0;

  constructor(portal: Texture) {
    this.root.name = 'GiantPrint';
    this.photo = new Photograph({ photo: this.stillRT.texture, grade: new Grade() });
    this.photo.scale.setScalar(G.scale);
    const u = this.photo.uniforms;
    u.tPortal.value = portal;
    u.uDevelop.value = 1;

    // pegged to a wire at its top edge; the hanger swings around that edge
    const top = G.center[1] + (print.height * G.scale) / 2;
    this.hanger.position.set(G.center[0], top, G.z);
    this.photo.position.set(0, -(print.height * G.scale) / 2, 0);
    this.hanger.add(this.photo);
    this.root.add(this.hanger);
    this.root.add(this.buildWire(top));

    const l = G.light;
    const light = new PointLight(LIGHT_COLORS.tungsten, l.intensity, l.distance, 2);
    light.position.set(0, l.height, G.z + l.ahead);
    this.root.add(light);
  }

  /** A wire from wall to wall pulled down to the print's top edge, and two pegs the size of the print. */
  private buildWire(top: number): Group {
    const hw = ALLEY.halfWidth;
    const group = new Group();
    const wire = new MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.55 });
    const pegX = print.width * G.scale * 0.32;
    const wall = (side: number) => new Vector3(side * (hw - 0.05), G.wire.height, G.z);
    const peg = (side: number) => new Vector3(G.center[0] + side * pegX, top + 0.04, G.z + 0.01);
    // between wall and peg the wire hangs a little under its own weight
    const droop = (side: number) => new Vector3().lerpVectors(wall(side), peg(side), 0.5).add(new Vector3(0, -G.wire.sag, 0));
    const points = [wall(-1), droop(-1), peg(-1), peg(1), droop(1), wall(1)];
    group.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(points), 64, 0.012, 6), wire));
    const wood = new MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.8 });
    const pegGeometry = new BoxGeometry(0.05, 0.32, 0.07);
    for (const side of [-1, 1]) {
      const p = new Mesh(pegGeometry, wood);
      p.position.copy(peg(side)).add(new Vector3(0, 0.02, 0.02));
      group.add(p);
    }
    return group;
  }

  /** Signed distance (m) of a point in front of the print's surface (walk frame, positive on the alley side). */
  distance(eye: Vector3): number {
    return eye.z - G.z;
  }

  /** 0 = still, 1 = live window, by the viewer's distance. */
  liveMix(eye: Vector3): number {
    return smootherstep(range(G.live[0], G.live[1], this.distance(eye)));
  }

  /** Is the image filling the whole view of `camera` (walk frame)? */
  covers(camera: PerspectiveCamera): boolean {
    const image = this.photo.image;
    image.updateWorldMatrix(true, false);
    normal.set(0, 0, 1).transformDirection(image.matrixWorld);
    plane.setFromNormalAndCoplanarPoint(normal, image.getWorldPosition(local));
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      corner.set(x, y, 0.5).unproject(camera);
      ray.origin.copy(camera.position);
      ray.direction.subVectors(corner, camera.position).normalize();
      if (!ray.intersectPlane(plane, hit)) return false;
      image.worldToLocal(hit);
      const limit = (photoConfig.image.size / 2) * (1 - COVER_MARGIN);
      if (Math.abs(hit.x) > limit || Math.abs(hit.y) > limit) return false;
    }
    return true;
  }

  /** The camera the still is taken from: on the image axis, `still.distance` in front, moved into the sea. */
  stillCamera(): PerspectiveCamera {
    const cam = new PerspectiveCamera(2 * Math.atan(HALF / G.still.distance) / DEG, 1, renderConfig.near, renderConfig.far);
    cam.position.copy(this.imageCenter).add(offset);
    cam.position.z += G.still.distance;
    cam.lookAt(local.copy(this.imageCenter).add(offset));
    cam.layers.set(LAYERS.WORLD);
    cam.layers.enable(LAYERS.DREAM);
    cam.updateMatrixWorld(true);
    return cam;
  }

  /**
   * The screen rectangle (drawing-buffer pixels) the image covers for `camera`, padded; null when it is
   * off screen. The live window only needs to be drawn there.
   */
  screenRect(camera: PerspectiveCamera, width: number, height: number, out: Vector4): Vector4 | null {
    const image = this.photo.image;
    image.updateWorldMatrix(true, false);
    const half = photoConfig.image.size / 2;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      corner.set(x * half, y * half, 0).applyMatrix4(image.matrixWorld);
      // behind the eye the projection flips: just draw everything
      if (local.copy(corner).applyMatrix4(camera.matrixWorldInverse).z > -camera.near) return out.set(0, 0, width, height);
      corner.project(camera);
      x0 = Math.min(x0, corner.x);
      x1 = Math.max(x1, corner.x);
      y0 = Math.min(y0, corner.y);
      y1 = Math.max(y1, corner.y);
    }
    if (x1 < -1 || x0 > 1 || y1 < -1 || y0 > 1) return null;
    const px = (v: number, size: number) => MathUtils.clamp(((v + 1) / 2) * size, 0, size);
    const left = Math.floor(px(x0, width)) - SCISSOR_PAD;
    const bottom = Math.floor(px(y0, height)) - SCISSOR_PAD;
    const right = Math.ceil(px(x1, width)) + SCISSOR_PAD;
    const top = Math.ceil(px(y1, height)) + SCISSOR_PAD;
    return out.set(Math.max(0, left), Math.max(0, bottom), Math.min(width, right) - Math.max(0, left), Math.min(height, top) - Math.max(0, bottom));
  }

  /** Sway on the wire, settling as you come close (so its image can cover the view steadily). */
  update(time: number, eye: Vector3): void {
    const settle = range(G.sway.stillWithin, G.sway.stillWithin * 2, this.distance(eye));
    this.sway = REDUCED_MOTION ? 0 : Math.sin((time / G.sway.period) * Math.PI * 2) * G.sway.amount * DEG * settle;
    this.hanger.rotation.x = this.sway;
  }
}
