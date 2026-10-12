import { memories, type MemoryId } from '../config/copy.config';

/** Where found memories are remembered between visits (a convenience: everything works without it). */
const STORAGE_KEY = 'dream-of-the-photo.memories';

/** The memories found so far, kept across visits like a game's collectibles. */
export class Memories {
  readonly total = Object.keys(memories).length;
  private readonly found = new Set<MemoryId>();

  constructor() {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
      if (Array.isArray(saved)) for (const id of saved) if (id in memories) this.found.add(id as MemoryId);
    } catch {
      // nothing remembered: start empty
    }
  }

  get count(): number {
    return this.found.size;
  }

  has(id: MemoryId): boolean {
    return this.found.has(id);
  }

  /** Mark a memory found; true if it was new. */
  find(id: MemoryId): boolean {
    if (this.found.has(id)) return false;
    this.found.add(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.found]));
    } catch {
      // private mode or blocked storage: it is found for this visit only
    }
    return true;
  }
}
