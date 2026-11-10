import { HalfFloatType, LinearMipmapLinearFilter, PerspectiveCamera, WebGLRenderTarget, type Texture } from 'three';
import { dreamConfig } from '../../config/dream.config';
import { LAYERS, renderConfig } from '../../config/experience.config';

/** Mostly seen overhead and at a slant: a little anisotropy keeps them sharp (the GPU clamps it). */
const ANISOTROPY = 4;

interface Moment {
  target: WebGLRenderTarget;
  camera: PerspectiveCamera;
}

/**
 * Pictures of the real moment before the shot (drifting over the sea): views rendered once, before the
 * piece starts, into small square HDR targets. Mipmapped, since they are mostly seen small and from afar.
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
        samples: renderConfig.denseSamples,
        generateMipmaps: true,
        minFilter: LinearMipmapLinearFilter,
        anisotropy: ANISOTROPY,
      });
      target.texture.name = `moment ${i}`;
      const camera = new PerspectiveCamera(view.fov, 1, renderConfig.near, renderConfig.far);
      camera.position.set(...view.position);
      camera.lookAt(...view.target);
      camera.layers.set(LAYERS.WORLD);
      camera.layers.enable(LAYERS.OUTER);
      camera.updateMatrixWorld(true);
      return { target, camera };
    });
    this.textures = this.moments.map((m) => m.target.texture);
  }

  /** Render every view (called after shaders are compiled); `render` shows the real moment into the target. */
  develop(render: (target: WebGLRenderTarget, camera: PerspectiveCamera) => void): void {
    for (const m of this.moments) render(m.target, m.camera);
  }
}
