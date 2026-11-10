import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';

/** Side of a kept picture (px), and the quality it is remembered at (JPEG). */
const SIDE = 320;
const QUALITY = 0.72;
/** Pictures survive closing the page only here, on the viewer's own machine. */
const KEY = 'dream-of-the-photo/album';

export interface AlbumPicture {
  /** The room it was taken in. */
  room: string;
  canvas: HTMLCanvasElement;
}

/**
 * What the shutter kept: at the worst moment of a room the piece really photographs what the viewer sees.
 * The corridor hangs them on its walls and the last room shows them all. Nothing here leaves the browser.
 */
export class Album {
  readonly pictures: AlbumPicture[] = [];

  constructor() {
    this.remember();
  }

  /** A square from the middle of the picture now on `source` (read at once: the buffer does not last). */
  take(room: string, source: HTMLCanvasElement): void {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIDE;
    const side = Math.min(source.width, source.height);
    canvas.getContext('2d')!.drawImage(source, (source.width - side) / 2, (source.height - side) / 2, side, side, 0, 0, SIDE, SIDE);
    const same = this.pictures.findIndex((p) => p.room === room);
    if (same >= 0) this.pictures[same] = { room, canvas };
    else this.pictures.push({ room, canvas });
    this.keep();
  }

  /** The picture as a texture (the caller owns it). */
  texture(picture: AlbumPicture): Texture {
    const t = new CanvasTexture(picture.canvas);
    t.colorSpace = SRGBColorSpace;
    return t;
  }

  /** Everything forgotten (starting over). */
  clear(): void {
    this.pictures.length = 0;
    this.keep();
  }

  private keep(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.pictures.map((p) => [p.room, p.canvas.toDataURL('image/jpeg', QUALITY)])));
    } catch {
      // private window or full storage: the album only lasts as long as the page
    }
  }

  private remember(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as [string, string][];
      for (const [room, url] of saved) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIDE;
        const image = new Image();
        image.onload = () => canvas.getContext('2d')!.drawImage(image, 0, 0, SIDE, SIDE);
        image.src = url;
        this.pictures.push({ room, canvas });
      }
    } catch {
      // nothing kept, or nowhere to look
    }
  }
}
