import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  RepeatWrapping,
  TorusGeometry,
  Vector2,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { cameraObjectConfig } from '../../config/scene.config';

const C = cameraObjectConfig;

/** Fine grain bump for plastic / leatherette, generated once (no external texture needed). */
function grainTexture(scale: number, contrast: number): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = Math.floor(i / size);
    const cell = Math.sin(x * scale) * Math.sin(y * scale * 1.13) * 0.5 + 0.5;
    const v = 128 + (Math.random() - 0.5) * contrast + (cell - 0.5) * contrast * 0.6;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

/**
 * A generic, unbranded instant camera designed for this piece: a soft-edged charcoal body,
 * leatherette front, machined lens barrel with a real glass element, viewfinder, flash window,
 * shutter button and a top film slot the print slides out of.
 * Local frame: lens looks down -Z, top is +Y, the photographer's eye is on +Z.
 */
export class InstantCamera extends Group {
  /** Where the photograph is taken from (front of the lens). */
  readonly lensAnchor = new Object3D();
  /** Where the print sits when fully inside the slot (it slides along +Y). */
  readonly slotAnchor = new Object3D();
  /** The back face of the viewfinder eyepiece (where the photographer's eye goes). */
  readonly eyepieceAnchor = new Object3D();
  private readonly flashMaterial: MeshStandardMaterial;
  private readonly button: Mesh;
  private readonly buttonRestY: number;

  constructor() {
    super();
    this.name = 'InstantCamera';
    const { width: w, height: h, depth: d } = C.body;

    const plastic = new MeshPhysicalMaterial({
      color: C.colors.body,
      roughness: 0.48,
      metalness: 0,
      clearcoat: 0.25,
      clearcoatRoughness: 0.6,
      bumpMap: grainTexture(0.9, 26),
      bumpScale: 0.25,
    });
    const leather = new MeshStandardMaterial({
      color: C.colors.leather,
      roughness: 0.82,
      bumpMap: grainTexture(2.3, 90),
      bumpScale: 0.9,
    });
    const metal = new MeshStandardMaterial({ color: C.colors.metal, roughness: 0.32, metalness: 1 });
    const blackMetal = new MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.4, metalness: 0.6 });
    const glass = new MeshPhysicalMaterial({
      color: 0x0a0d12,
      roughness: 0.04,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      iridescence: 0.35,
      iridescenceIOR: 1.6,
      reflectivity: 0.9,
    });
    const rubber = new MeshStandardMaterial({ color: 0x111112, roughness: 0.92 });
    this.flashMaterial = new MeshStandardMaterial({
      color: 0xdedbd2,
      roughness: 0.3,
      emissive: 0xfff3e2,
      emissiveIntensity: 0,
    });

    const body = new Mesh(new RoundedBoxGeometry(w, h, d, 5, C.body.radius), plastic);
    this.add(body);

    // leatherette band across the front, slightly proud of the body
    const band = new Mesh(new RoundedBoxGeometry(w * 0.985, h * 0.56, 0.003, 3, 0.0012), leather);
    band.position.set(0, -h * 0.13, -d / 2 - 0.0012);
    this.add(band);

    // lens barrel: machined profile revolved around the optical axis
    const r = C.lens.radius;
    const profile = [
      new Vector2(r * 0.55, 0),
      new Vector2(r * 1.08, 0),
      new Vector2(r * 1.08, C.lens.length * 0.25),
      new Vector2(r * 1.0, C.lens.length * 0.3),
      new Vector2(r * 1.0, C.lens.length * 0.82),
      new Vector2(r * 0.94, C.lens.length * 0.9),
      new Vector2(r * 0.94, C.lens.length),
      new Vector2(r * 0.7, C.lens.length),
      new Vector2(r * 0.66, C.lens.length * 0.92),
    ];
    const barrel = new Mesh(new LatheGeometry(profile, 64), metal);
    barrel.rotation.x = -Math.PI / 2;
    barrel.position.set(C.lens.offset.x, C.lens.offset.y, -d / 2);
    this.add(barrel);
    const knurl = new Mesh(new TorusGeometry(r * 1.02, 0.0012, 6, 96), blackMetal);
    knurl.position.set(C.lens.offset.x, C.lens.offset.y, -d / 2 - C.lens.length * 0.55);
    this.add(knurl);
    const element = new Mesh(new CylinderGeometry(r * 0.68, r * 0.68, 0.002, 48), glass);
    element.rotation.x = Math.PI / 2;
    element.position.set(C.lens.offset.x, C.lens.offset.y, -d / 2 - C.lens.length * 0.93);
    this.add(element);
    this.lensAnchor.position.set(C.lens.offset.x, C.lens.offset.y, -d / 2 - C.lens.length);
    this.add(this.lensAnchor);

    // viewfinder (front window + rear eyepiece)
    const vf = new Mesh(new RoundedBoxGeometry(0.018, 0.013, 0.004, 2, 0.002), glass);
    vf.position.set(-w * 0.32, h * 0.33, -d / 2 - 0.0006);
    this.add(vf);
    const eyepieceDepth = 0.008;
    const eyepiece = new Mesh(new RoundedBoxGeometry(0.022, 0.017, eyepieceDepth, 2, 0.003), rubber);
    eyepiece.position.set(-w * 0.32, h * 0.33, d / 2 + 0.002);
    this.add(eyepiece);
    this.eyepieceAnchor.position.copy(eyepiece.position).setZ(eyepiece.position.z + eyepieceDepth / 2);
    this.add(this.eyepieceAnchor);

    // flash window
    const flash = new Mesh(new RoundedBoxGeometry(0.028, 0.014, 0.003, 2, 0.0015), this.flashMaterial);
    flash.position.set(w * 0.3, h * 0.33, -d / 2 - 0.0005);
    this.add(flash);

    // shutter button on the top, right hand side (photographer's right = +X)
    this.button = new Mesh(new CylinderGeometry(0.0062, 0.0066, 0.004, 32), metal);
    this.buttonRestY = h / 2 + 0.0016;
    this.button.position.set(w * 0.3, this.buttonRestY, -d * 0.12);
    this.add(this.button);
    const collar = new Mesh(new TorusGeometry(0.0072, 0.0009, 8, 40), blackMetal);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(w * 0.3, h / 2 + 0.0004, -d * 0.12);
    this.add(collar);

    // film slot along the top (dark throat the print slides out of)
    const slot = new Mesh(new BoxGeometry(C.slot.width, 0.0024, C.slot.depth), new MeshStandardMaterial({ color: 0x050505, roughness: 1 }));
    slot.position.set(0, h / 2 - 0.0008, C.slot.z);
    this.add(slot);
    this.slotAnchor.position.set(0, h / 2 - C.slot.insideDepth, C.slot.z);
    this.add(this.slotAnchor);

    // strap lugs
    for (const side of [-1, 1]) {
      const lug = new Mesh(new TorusGeometry(0.0045, 0.0013, 8, 20), metal);
      lug.position.set(side * (w / 2 + 0.002), h * 0.3, 0);
      lug.rotation.y = Math.PI / 2;
      this.add(lug);
    }

    // rear film door seam
    const seam = new Mesh(new BoxGeometry(w * 0.82, h * 0.7, 0.0008), new MeshStandardMaterial({ color: 0x1d1d20, roughness: 0.7 }));
    seam.position.set(0, -h * 0.05, d / 2 + 0.0002);
    this.add(seam);


    this.traverse((o) => {
      if ((o as Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  /** 0 = released, 1 = fully pressed. */
  set buttonPress(v: number) {
    this.button.position.y = this.buttonRestY - v * 0.0018;
  }

  set flash(v: number) {
    this.flashMaterial.emissiveIntensity = v * 40;
  }
}
