import { lang } from '../../ui/i18n';
import type { Text } from '../../config/copy.config';

/** What the tab says while the viewer is away, one after the other (s between them). */
const AWAY: readonly Text[] = [
  { tr: 'Arkana bakma', en: 'Do not look behind you' },
  { tr: 'Hâlâ buradayım', en: 'I am still here' },
  { tr: 'Saçın ağarıyor', en: 'Your hair is turning white' },
  { tr: 'Geri dön', en: 'Come back' },
];
const AWAY_STEP = 7;

/** The viewer's own clock, as a clock on a wall would say it. */
export function clockNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The viewer's own date, as it is cut into a stone. */
export function dateNow(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/**
 * The nightmare outside the picture. It knows only what the browser knows of its own accord: the time, the
 * date, whether the tab is being looked at. No camera, no microphone; nothing ever leaves the page.
 */
export class FourthWall {
  /** Seconds the page was just away: set on the frame it came back (the director hands it to the room), then 0. */
  returned = 0;
  private readonly title = document.title;
  private leftAt = 0;
  private timer = 0;

  constructor() {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = (): void => {
    window.clearInterval(this.timer);
    if (document.hidden) {
      this.leftAt = performance.now();
      let i = 0;
      const next = () => {
        document.title = AWAY[i++ % AWAY.length][lang()];
      };
      this.timer = window.setInterval(next, AWAY_STEP * 1000);
      return;
    }
    document.title = this.title;
    this.returned = (performance.now() - this.leftAt) / 1000;
  };
}
