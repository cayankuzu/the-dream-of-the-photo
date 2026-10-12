import {
  AnimationAction,
  AnimationMixer,
  AnimationUtils,
  Euler,
  Group,
  LoopRepeat,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type AnimationClip,
  type SkinnedMesh,
} from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { LAYERS, photographerConfig as P, photoConfig } from '../../config/experience.config';
import { cameraObjectConfig } from '../../config/scene.config';
import { InstantCamera } from '../camera-object/InstantCamera';
import type { Photograph } from '../photograph/Photograph';
import { DEG, range, smootherstep, wobble } from '../math';
import { cueToProgress, phaseEnd, phaseProgress, phaseStart, SHUTTER_PROGRESS } from '../timeline/Timeline';
import { NumberTrack } from '../timeline/Track';
import { setWorldQuaternion, TwoBoneIK } from './TwoBoneIK';

const BONES = {
  head: 'Bip01_Head',
  neck: 'Bip01_Neck',
  rEye: 'Bip01_REye',
  rHand: 'Bip01_R_Hand',
  lUpper: 'Bip01_L_UpperArm',
  lFore: 'Bip01_L_Forearm',
  lHand: 'Bip01_L_Hand',
} as const;

/**
 * Pinch on the print: extra flexion (rad, around each joint's local Z — the Biped bend axis)
 * for the three joints of thumb, index, middle, ring and little finger.
 */
const PINCH: readonly (readonly [number, number, number])[] = [
  [0.1, 0.25, 0.2],
  [0.25, 0.35, 0.25],
  [0.45, 0.55, 0.35],
  [0.6, 0.65, 0.4],
  [0.7, 0.7, 0.45],
];

/**
 * Left-hand grip of a print (print-local, +Z faces the photographer): the hand is behind the paper
 * with the palm against its back, fingers up; the thumb wraps the left edge onto the wide bottom
 * border. Nothing of the hand ever covers the image, so the print can fill the screen cleanly.
 */
const PRINT_GRIP = {
  point: new Vector3(-photoConfig.print.width / 2 + 0.009, -photoConfig.print.height / 2 + 0.007, 0),
  /** From the wrist (behind and below the print) the fingers rise along the paper's back. */
  fingers: new Vector3(0.18, 0.95, 0.12).normalize(),
  palm: new Vector3(0, -0.1, 1),
  wristBack: 0.075,
  palmGap: 0.016,
};

const AXIS_Z = new Vector3(0, 0, 1);
const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();
const q1 = new Quaternion();
const q2 = new Quaternion();
const m1 = new Matrix4();
const m2 = new Matrix4();
const scaleTmp = new Vector3();

/**
 * A body that will not move again can be culled like any mesh: bound it in its frozen pose
 * (animated bodies are never culled, their bind-pose bounds lie).
 */
function cullFrozen(root: Object3D): void {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as SkinnedMesh;
    if (!mesh.isMesh) return;
    if (mesh.isSkinnedMesh) {
      mesh.skeleton.update();
      mesh.computeBoundingSphere();
    }
    mesh.frustumCulled = true;
  });
}

function basisQuaternion(x: Vector3, yHint: Vector3, out: Quaternion): Quaternion {
  const y = v3.copy(yHint).addScaledVector(x, -yHint.dot(x)).normalize();
  const z = new Vector3().crossVectors(x, y);
  return out.setFromRotationMatrix(m2.makeBasis(x, y, z));
}

/**
 * The photographer: Rocketbox mocap scrubbed by the timeline, a camera that lives in the right hand,
 * a print pulled out and lifted by the left hand (two-bone IK), a head that looks at what matters.
 */
export class Photographer {
  readonly root = new Group();
  readonly camera = new InstantCamera();
  /** Shadow-only double frozen at the moment of capture (exists only inside the picture). */
  readonly ghost = new Group();

  private readonly model: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly take: AnimationAction;
  private readonly breathe: AnimationAction;
  private readonly bones: Record<keyof typeof BONES, Object3D>;
  private readonly leftArm: TwoBoneIK;
  private readonly leftFingers: Object3D[][];
  private readonly clipTime = new NumberTrack(P.clip);
  private readonly grip = new Matrix4();
  private readonly ghostModel: Object3D;
  private readonly ghostCamera: Object3D;

  /** Print pose in world space this frame (read by the director and the transition). */
  readonly printPosition = new Vector3();
  private readonly printQuaternion = new Quaternion();
  private printVisible = false;

  constructor(gltf: GLTF, private readonly print: Photograph) {
    this.root.name = 'Photographer';
    this.model = gltf.scene;
    this.root.add(this.model);
    this.root.position.set(...P.position);
    this.root.rotation.y = P.heading * DEG;
    this.model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const mat = mesh.material as MeshStandardMaterial;
      mat.envMapIntensity = P.envMapIntensity;
    });

    this.mixer = new AnimationMixer(this.model);
    const clip = (name: string) => gltf.animations.find((c) => c.name === name) as AnimationClip;
    this.take = this.mixer.clipAction(clip('m_take_picture'));
    this.take.play();
    this.take.paused = true;
    // breathing rides on top of every pose as an additive layer
    const idle = clip('m_idle_breathe_01').clone();
    AnimationUtils.makeClipAdditive(idle);
    this.breathe = this.mixer.clipAction(idle);
    this.breathe.setLoop(LoopRepeat, Infinity);
    this.breathe.setEffectiveWeight(P.breathing);
    this.breathe.play();

    this.bones = Object.fromEntries(
      Object.entries(BONES).map(([k, n]) => {
        const b = this.model.getObjectByName(n);
        if (!b) throw new Error(`photographer bone missing: ${n}`);
        return [k, b];
      }),
    ) as Record<keyof typeof BONES, Object3D>;
    this.leftArm = new TwoBoneIK(this.bones.lUpper, this.bones.lFore, this.bones.lHand);
    this.leftFingers = [0, 1, 2, 3, 4].map((f) =>
      ['', '1', '2'].map((j) => this.model.getObjectByName(`Bip01_L_Finger${f}${j}`)!),
    );

    this.root.add(this.camera, this.print);
    this.print.visible = false;
    this.calibrateGrip();

    // the ghost: same body, frozen at the shutter, visible only to light
    this.ghostModel = cloneSkinned(this.model);
    const shadowOnly = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const ghostify = (o: Object3D) =>
      o.traverse((c) => {
        const mesh = c as Mesh;
        if (mesh.isMesh) {
          mesh.material = shadowOnly;
          mesh.castShadow = true;
          mesh.receiveShadow = false;
          mesh.frustumCulled = false;
        }
      });
    ghostify(this.ghostModel);
    // copy the camera's meshes only (cloning the class would rebuild it)
    this.ghostCamera = new Group();
    for (const child of this.camera.children) this.ghostCamera.add(child.clone());
    ghostify(this.ghostCamera);
    this.ghost.add(this.ghostModel, this.ghostCamera);
    this.ghost.position.copy(this.root.position);
    this.ghost.rotation.copy(this.root.rotation);
    this.ghost.visible = false;

    this.root.traverse((o) => o.layers.set(LAYERS.OUTER));
    this.ghost.traverse((o) => o.layers.set(LAYERS.DREAM));
  }

  /** The camera sits in the right hand so that, mid-shot, the viewfinder is at the right eye. */
  private calibrateGrip(): void {
    this.take.time = P.calibrateAt;
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const eye = this.bones.rEye.getWorldPosition(new Vector3());
    const q = this.aimQuaternion(new Quaternion());
    const forward = new Vector3(0, 0, -1).applyQuaternion(q);
    const eyepiece = this.camera.eyepieceAnchor.position.clone().applyQuaternion(q);
    const center = eye.addScaledVector(forward, P.eyepieceGap).sub(eyepiece);
    const camWorld = new Matrix4().compose(center, q, new Vector3(1, 1, 1));
    this.grip.copy(this.bones.rHand.matrixWorld).invert().multiply(camWorld);
  }

  /** Designed framing: level, straight down the alley, a hair below the horizon. */
  aimQuaternion(out: Quaternion): Quaternion {
    return out.setFromEuler(new Euler(P.aimPitch * DEG, P.heading * DEG + 180 * DEG, 0, 'YXZ'));
  }

  update(p: number, time: number): void {
    const intro = 1 - range(0, 0.06, p);
    this.take.time = this.clipTime.at(p) + intro * P.idleSway * wobble(time * 0.6, 1);
    // breathing is time-driven while the performance itself is scrubbed by the timeline
    this.breathe.time = time % this.breathe.getClip().duration;
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);

    // order matters: the clavicles hang from the neck, so the gaze is set before anything is held
    // (it follows the print's previous position, which is smooth from frame to frame)
    this.updateHead(p);
    this.updateCamera(p);
    this.updatePrint(p, time);
  }

  // ------------------------------------------------------------------ camera in hand

  private updateCamera(p: number): void {
    m1.multiplyMatrices(this.bones.rHand.matrixWorld, this.grip);
    m1.decompose(v1, q1, scaleTmp);
    // during the shot the lens settles on the designed framing (the hand hides the difference)
    const settle =
      smootherstep(range(phaseStart('AIM'), phaseStart('FOCUS'), p)) *
      (1 - smootherstep(range(phaseEnd('CAPTURE'), phaseEnd('CAPTURE') + P.aimRelease, p)));
    if (settle > 0) q1.slerp(this.aimQuaternion(q2), settle);
    this.root.worldToLocal(v1);
    this.camera.position.copy(v1);
    this.camera.quaternion.copy(q2.copy(this.root.quaternion).invert().multiply(q1));
    this.camera.updateMatrixWorld(true);
    const b = P.button;
    const press = range(-b.lead, 0, p - SHUTTER_PROGRESS) * (1 - range(b.release[0], b.release[1], p - SHUTTER_PROGRESS));
    this.camera.buttonPress = press;
  }

  /** World pose of the lens (the PhotoCamera at the shutter). */
  lensPose(position: Vector3, quaternion: Quaternion): void {
    this.camera.lensAnchor.getWorldPosition(position);
    this.camera.lensAnchor.getWorldQuaternion(quaternion);
  }

  // ------------------------------------------------------------------ the print

  private updatePrint(p: number, time: number): void {
    const eject = phaseProgress(p, 'PHOTO_EJECT');
    const reveal = phaseProgress(p, 'PHOTO_REVEAL');
    const { reachEnd, pullEnd, liftEnd } = P.print;
    this.printVisible = p > phaseStart('PHOTO_EJECT');
    this.print.visible = this.printVisible;
    if (!this.printVisible) return;

    // 1. sliding out of the top slot, attached to the camera
    const slideOut = cameraObjectConfig.ejectDistance * smootherstep(range(P.print.slide[0], P.print.slide[1], eject));
    const pull = range(reachEnd, pullEnd, reveal);
    const slide = slideOut + pull * (photoConfig.print.height * 0.5 + 0.01);
    this.camera.slotAnchor.getWorldPosition(v1);
    this.camera.getWorldQuaternion(q1);
    v1.add(v2.set(0, slide, 0).applyQuaternion(q1));
    const inSlotPos = v1.clone();
    const inSlotQuat = q1.clone();

    // 2. lifted in front of the eyes to be looked at
    const view = this.viewPose(new Vector3(), new Quaternion(), time, p);
    const lift = smootherstep(range(pullEnd, liftEnd, reveal));
    this.printPosition.lerpVectors(inSlotPos, view.position, lift);
    this.printPosition.y += Math.sin(lift * Math.PI) * P.print.arc; // a small arc, not a straight line
    this.printQuaternion.slerpQuaternions(inSlotQuat, view.quaternion, lift);
    this.applyPrintPose();

    // 3. the left hand reaches for it, and from then on the print is wherever that hand really is
    const reach = smootherstep(range(0, reachEnd, reveal));
    if (reach > 0) this.holdPrint(reach);
    this.print.curlAmount = photoConfig.curl * (1 - range(phaseStart('PHOTO_APPROACH'), phaseStart('PHOTO_DEPTH'), p));
  }

  /** Place the print object at printPosition / printQuaternion (world). */
  private applyPrintPose(): void {
    this.root.worldToLocal(v1.copy(this.printPosition));
    this.print.position.copy(v1);
    this.print.quaternion.copy(q2.copy(this.root.quaternion).invert().multiply(this.printQuaternion));
    this.print.updateMatrixWorld(true);
  }

  private viewPose(position: Vector3, quaternion: Quaternion, time: number, p: number) {
    const eye = this.bones.rEye.getWorldPosition(v1);
    const off = v2.set(...P.print.viewOffset).applyQuaternion(this.root.quaternion);
    position.copy(eye).add(off);
    // face the eyes, with a slight lean
    const toEye = v3.subVectors(eye, position).normalize();
    const yawOnly = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(toEye.x, toEye.z));
    quaternion.copy(yawOnly).multiply(new Quaternion().setFromEuler(new Euler(...P.print.viewTilt.map((a) => a * DEG) as [number, number, number])));
    // living hand: a faint tremor that calms down as the viewer gets closer
    const calm = 1 - range(phaseStart('PHOTO_APPROACH'), phaseStart('PHOTO_DEPTH'), p);
    const t = P.print.tremor * (0.35 + 0.65 * calm);
    position.x += wobble(time * 3.1, 2) * t;
    position.y += wobble(time * 2.7, 5) * t;
    quaternion.multiply(q2.setFromEuler(new Euler(wobble(time * 2.3, 7) * t * 3, wobble(time * 1.9, 9) * t * 3, 0)));
    return { position, quaternion };
  }

  private holdPrint(weight: number): void {
    // where the wrist must be for the designed grip
    const fingers = new Vector3().copy(PRINT_GRIP.fingers).applyQuaternion(this.printQuaternion);
    const palm = new Vector3().copy(PRINT_GRIP.palm).normalize().applyQuaternion(this.printQuaternion);
    const grip = new Vector3().copy(PRINT_GRIP.point).applyQuaternion(this.printQuaternion).add(this.printPosition);
    const wrist = grip.clone().addScaledVector(fingers, -PRINT_GRIP.wristBack).addScaledVector(palm, -PRINT_GRIP.palmGap);
    const handQ = basisQuaternion(fingers, palm, new Quaternion());
    // print relative to that designed hand (constant for the grip)
    const handScale = this.bones.lHand.getWorldScale(new Vector3());
    const designedHand = m1.compose(wrist, handQ, handScale);
    const printInHand = m2.copy(designedHand).invert().multiply(new Matrix4().compose(this.printPosition, this.printQuaternion, v3.set(1, 1, 1)));

    const shoulder = this.bones.lUpper.getWorldPosition(new Vector3());
    const left = new Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
    const pole = shoulder.clone().add(new Vector3(0, -P.elbowPole.down, 0)).addScaledVector(left, P.elbowPole.out);
    this.leftArm.solve(wrist, pole, weight);
    const animated = this.bones.lHand.getWorldQuaternion(new Quaternion());
    setWorldQuaternion(this.bones.lHand, animated.slerp(handQ, weight));
    this.leftFingers.forEach((joints, f) =>
      joints.forEach((bone, j) => bone.quaternion.multiply(q1.setFromAxisAngle(AXIS_Z, PINCH[f][j] * weight))),
    );
    this.bones.lHand.updateMatrixWorld(true);

    // the print follows the real hand (the arm may not reach the exact designed spot)
    const held = new Matrix4().multiplyMatrices(this.bones.lHand.matrixWorld, printInHand);
    const heldPos = new Vector3();
    const heldQuat = new Quaternion();
    held.decompose(heldPos, heldQuat, v3);
    const follow = weight * weight;
    this.printPosition.lerp(heldPos, follow);
    this.printQuaternion.slerp(heldQuat, follow);
    this.applyPrintPose();
  }

  // ------------------------------------------------------------------ gaze

  private updateHead(p: number): void {
    const g = P.gaze;
    const w = smootherstep(range(cueToProgress(['PHOTO_REVEAL', g.from]), cueToProgress(['PHOTO_REVEAL', g.to]), p));
    if (w <= 0 || !this.printVisible) return;
    for (const [bone, share] of [
      [this.bones.neck, g.neckShare],
      [this.bones.head, 1],
    ] as const) {
      const pos = bone.getWorldPosition(v1);
      const target = v2.subVectors(this.printPosition, pos).normalize();
      // Biped head/neck look along their local +Y
      const forward = v3.set(0, 1, 0).applyQuaternion(bone.getWorldQuaternion(q1)).normalize();
      q2.setFromUnitVectors(forward, target);
      q2.slerp(new Quaternion(), 1 - w * share);
      setWorldQuaternion(bone, q2.multiply(q1));
    }
  }

  // ------------------------------------------------------------------ doubles

  /**
   * A separate body frozen at a mocap time, holding its own camera (the figure seen at the far end
   * of the alley inside the picture). Returned without layers; the caller decides where it exists.
   */
  makeDouble(clipTime: number): Group {
    const keep = this.take.time;
    this.take.time = clipTime;
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const body = cloneSkinned(this.model);
    const holder = new Group();
    holder.add(body);
    const cam = new Group();
    for (const child of this.camera.children) cam.add(child.clone());
    // camera relative to the body, using the same grip as the real hands
    const rootInv = new Matrix4().copy(this.root.matrixWorld).invert();
    new Matrix4().multiplyMatrices(rootInv, new Matrix4().multiplyMatrices(this.bones.rHand.matrixWorld, this.grip)).decompose(cam.position, cam.quaternion, cam.scale);
    holder.add(cam);
    this.take.time = keep;
    this.mixer.update(0);
    cullFrozen(holder);
    return holder;
  }

  // ------------------------------------------------------------------ ghost

  /** Freeze the shadow double in the current pose (called at the shutter). */
  freezeGhost(): void {
    const src = new Map<string, Object3D>();
    this.model.traverse((o) => src.set(o.name, o));
    this.ghostModel.traverse((o) => {
      const s = src.get(o.name);
      if (s && o !== this.ghostModel) {
        o.position.copy(s.position);
        o.quaternion.copy(s.quaternion);
        o.scale.copy(s.scale);
      }
    });
    this.ghostCamera.position.copy(this.camera.position);
    this.ghostCamera.quaternion.copy(this.camera.quaternion);
    this.ghost.visible = true;
    cullFrozen(this.ghost);
  }
}

