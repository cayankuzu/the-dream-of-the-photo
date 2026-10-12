import { HalfFloatType, LinearMipmapLinearFilter, PerspectiveCamera, WebGLRenderTarget, type Texture } from 'three';
import { dreamConfig } from '../../config/dream.config';
import { LAYERS, renderConfig } from '../../config/experience.config';
import { inSea } from '../../config/sea.config';
import { walkConfig } from '../../config/walk.config';

/** Which moment a view is taken in: the real one before the shot, or the dream further along the walk. */
export type MomentPass = 'real' | 'dream';

/** The pictures are small on screen: the sample count used on dense screens is plenty. */
const SAMPLES = renderConfig.denseSamples;
/** Mostly seen overhead and at a slant: a little anisotropy keeps them sharp (the GPU clamps it). */
const ANISOTROPY = 4;

interface Moment {
  target: WebGLRenderTarget;
  camera: PerspectiveCamera;
  pass: MomentPass;
}

/**
 * The pictures the dream is full of (pegged on the washing lines, drifting over the sea): views
 * rendered once, before the piece starts, into small square HDR targets. Each keeps the scene-linear
 * light it recorded; mipmapped, since it is mostly seen small and from afar.
 */
export class Moments {
  /** One texture per configured view (blank until developed). */
  readonly textures: Texture[];
  private readonly moments: Moment[];

  constructor() {
    const { resolution, views } = dreamConfig.moments;
    this.moments = views.map((view, i) => {
      const target = new WebGLRenderTarget(resolution, resolution, {
        type: HalfFloatType,
        samples: SAMPLES,
        generateMipmaps: true,
        minFilter: LinearMipmapLinearFilter,
        anisotropy: ANISOTROPY,
      });
      target.texture.name = `moment ${i}`;

      // past the giant print the walk goes on in the sea, which is drawn at its offset
      const beyond = view.pass === 'dream' && view.position[2] < walkConfig.printZ;
      const camera = new PerspectiveCamera(view.fov, 1, renderConfig.near, renderConfig.far);
      camera.position.set(...(beyond ? inSea(view.position) : view.position));
      camera.lookAt(...(beyond ? inSea(view.target) : view.target));
      camera.layers.set(LAYERS.WORLD);
      camera.layers.enable(view.pass === 'real' ? LAYERS.OUTER : LAYERS.DREAM);
      camera.updateMatrixWorld(true);
      return { target, camera, pass: view.pass };
    });
    this.textures = this.moments.map((m) => m.target.texture);
  }

  /**
   * Render every view once (called after shaders are compiled). Dream views beyond the giant
   * print (walk-frame z < walkConfig.printZ) are offset into the sea by seaConfig.offset.
   * `render` switches the world to the pass and draws the scene into the target.
   */
  develop(render: (target: WebGLRenderTarget, camera: PerspectiveCamera, pass: MomentPass) => void): void {
    // twice: a view that sees other pictures (the prints drifting over the sea) must find them developed
    for (let round = 0; round < 2; round++) for (const m of this.moments) render(m.target, m.camera, m.pass);
  }
}
