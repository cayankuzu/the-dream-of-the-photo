import './styles/main.css';
import { Experience } from './experience/Experience';
import { say } from './ui/i18n';
import { Overlay } from './ui/Overlay';

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;

function webglAvailable(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    // every pass renders into half-float targets
    return !!gl && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  } catch {
    return false;
  }
}

if (!webglAvailable()) {
  new Overlay().fail(say('noWebgl'));
} else {
  new Experience(canvas).start().catch((error: unknown) => {
    console.error(error);
    new Overlay().fail(say('failed'));
  });
}
