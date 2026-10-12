import type { WebGLRenderer } from 'three';
import { PHASES } from '../../config/experience.config';
import { phaseStart, type Timeline } from '../timeline/Timeline';

export interface DebugSnapshot {
  camera: { x: number; y: number; z: number };
  view: string;
  transition: string;
  assets: string;
}

/**
 * Development-only overlay (?debug): frame stats, timeline state and phase seeking
 * (keys 1-9, 0, -, = jump to the twelve phases).
 */
export class Debug {
  private readonly el = document.createElement('pre');
  private frames = 0;
  private clock = 0;
  private fps = 0;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly timeline: Timeline,
  ) {
    Object.assign(this.el.style, {
      position: 'fixed',
      left: '10px',
      top: '10px',
      margin: '0',
      padding: '8px 10px',
      font: '11px/1.45 ui-monospace, monospace',
      color: '#cfe8cf',
      background: 'rgba(0,0,0,0.55)',
      zIndex: '10',
      pointerEvents: 'none',
      whiteSpace: 'pre',
    });
    document.body.appendChild(this.el);
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
    window.addEventListener('keydown', (e) => {
      const i = keys.indexOf(e.key);
      if (i >= 0 && i < PHASES.length) timeline.seek(phaseStart(PHASES[i]) + 0.0005);
    });
  }

  update(dt: number, snap: DebugSnapshot): void {
    this.frames++;
    this.clock += dt;
    if (this.clock < 0.25) return;
    this.fps = this.frames / this.clock;
    this.frames = 0;
    this.clock = 0;
    const info = this.renderer.info;
    const { phase, local } = this.timeline.info;
    this.el.textContent = [
      `fps        ${this.fps.toFixed(1)}`,
      `draw calls ${info.render.calls}`,
      `triangles  ${info.render.triangles.toLocaleString()}`,
      `textures   ${info.memory.textures}  geometries ${info.memory.geometries}`,
      `pixelRatio ${this.renderer.getPixelRatio().toFixed(2)}`,
      `progress   ${this.timeline.progress.toFixed(4)} -> ${this.timeline.target.toFixed(4)}`,
      `state      ${phase} ${(local * 100).toFixed(0)}%`,
      `view       ${snap.view}`,
      `transition ${snap.transition}`,
      `camera     ${snap.camera.x.toFixed(2)} ${snap.camera.y.toFixed(2)} ${snap.camera.z.toFixed(2)}`,
      `assets     ${snap.assets}`,
    ].join('\n');
  }
}
