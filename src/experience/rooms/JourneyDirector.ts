import { Group, Vector3, type BufferGeometry, type InstancedMesh, type Material, type Mesh, type Object3D, type RenderTarget, type ShaderMaterial, type SkinnedMesh, type Sprite, type Texture } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Text } from '../../config/copy.config';
import { isRoom, JOURNEY, ROOM_SLOTS, ROOM_SPACE, ROOM_STEP, roomFile, roomVisit, type Cut, type WalkStep } from '../../config/journey.config';
import { at } from '../../config/experience.config';
import type { AudioEngine } from '../audio/AudioEngine';
import type { Assets, MaterialMaps } from '../assets/Assets';
import type { DreamDirector } from '../director/DreamDirector';
import { JOURNEY_STEPS, phaseStart, roomAt, stepAt } from '../timeline/Timeline';
import { Album } from './Album';
import type { Room, RoomAssets, RoomContext } from './Room';
import { RoomSound } from './RoomSound';

/** A room's file: what it needs, and how to build it. */
interface RoomFile {
  assets?: RoomAssets;
  default: new (ctx: RoomContext) => Room;
}

const FILES = import.meta.glob<RoomFile>('./list/*.ts');

/** Seconds of the piece before a step that its files start to be fetched, and that it is built (under the cut). */
const FETCH_AHEAD = at(40);
const BUILD_AHEAD = at(0.5);
/** Black before and after a cut (seconds of the piece). */
const CUT_OUT = at(0.45);
const CUT_IN = at(0.7);
const FLASH_OUT = at(0.12);
const FLASH_IN = at(1.1);

type State = 'none' | 'fetching' | 'fetched' | 'building' | 'ready' | 'failed';

const breathe = () => new Promise((resolve) => setTimeout(resolve));

/** What a room can reach on the page around it. */
export interface RoomStage {
  say(text: Text, seconds: number): void;
  hint(text: Text | null): void;
}

/**
 * Everything a dropped room's mesh holds on the GPU; what belongs to a loaded file or to the people stays, and so
 * does what something still alive draws with.
 */
function release(root: Group, keep: ReadonlySet<Texture>, uniformsOf: UniformsOf, used: InUse): void {
  const textures = new Set<Texture>();
  const materials = new Set<Material>();
  const take = (value: unknown) => {
    const t = value as Texture | null;
    if (t?.isTexture && !t.isRenderTargetTexture && !keep.has(t) && !used.textures.has(t)) textures.add(t);
  };
  const takeAll = (uniforms: Record<string, { value: unknown }> | undefined, only?: RegExp) => {
    if (!uniforms) return;
    for (const [name, u] of Object.entries(uniforms)) if (!only || only.test(name)) for (const v of Array.isArray(u?.value) ? u.value : [u?.value]) take(v);
  };
  root.traverse((o) => {
    // meshes, points and lines all carry their own geometry and material; sprites share one geometry
    const drawn = o as Mesh;
    if (!drawn.geometry || !drawn.material) return;
    if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose();
    if (o.userData.shared) return;
    // a body that moves keeps its bones in a texture of its own
    if ((o as SkinnedMesh).isSkinnedMesh) (o as SkinnedMesh).skeleton?.dispose();
    if (!(o as Sprite).isSprite && !used.geometries.has(drawn.geometry)) drawn.geometry.dispose();
    for (const m of Array.isArray(drawn.material) ? drawn.material : [drawn.material]) if (!used.materials.has(m)) materials.add(m);
  });
  for (const m of materials) {
    for (const value of Object.values(m)) take(value);
    // a shader keeps its pictures in its uniforms; one patched on compile, in the uniforms it was given then
    takeAll((m as ShaderMaterial).uniforms);
    takeAll(uniformsOf(m), OWN_UNIFORM);
    m.dispose();
  }
  for (const t of textures) t.dispose();
}

/** The uniforms a material's program was compiled with, if it has been. */
export type UniformsOf = (material: Material) => Record<string, { value: unknown }> | undefined;
/** Uniforms a room added itself (uName), as opposed to three's own (map, envMap, shadow maps...). */
const OWN_UNIFORM = /^u[A-Z]/;

/** Every picture a material shows: its maps, and those in its uniforms (its own, and three's once compiled). */
function picturesOf(m: Material, uniformsOf: UniformsOf, add: (t: Texture) => void): void {
  const take = (value: unknown) => {
    if ((value as Texture | null)?.isTexture) add(value as Texture);
  };
  for (const value of Object.values(m)) take(value);
  for (const uniforms of [(m as ShaderMaterial).uniforms, uniformsOf(m)]) {
    if (uniforms) for (const u of Object.values(uniforms)) for (const v of Array.isArray(u?.value) ? u.value : [u?.value]) take(v);
  }
}

/** The materials of everything under `root`. */
function materialsUnder(root: Object3D, each: (m: Material) => void): void {
  root.traverse((o) => {
    const material = (o as Mesh).material as Material | Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) each(m);
  });
}

/** What everything still in the scene draws with. */
interface InUse {
  geometries: Set<BufferGeometry>;
  materials: Set<Material>;
  textures: Set<Texture>;
  /** Their images: a texture's clones share its image, and its GL texture. */
  sources: Set<object>;
}

function inUse(scene: Object3D, uniformsOf: UniformsOf): InUse {
  const used: InUse = { geometries: new Set(), materials: new Set(), textures: new Set(), sources: new Set() };
  scene.traverse((o) => {
    if ((o as Mesh).geometry) used.geometries.add((o as Mesh).geometry);
  });
  materialsUnder(scene, (m) => {
    if (used.materials.has(m)) return;
    used.materials.add(m);
    picturesOf(m, uniformsOf, (t) => {
      used.textures.add(t);
      used.sources.add(t.source);
    });
  });
  return used;
}

/**
 * What a dropped room holds outside its scene: pictures and render targets in its own fields, in arrays of them,
 * or in plain uniform objects it handed to a shader. Instances of other classes (the album, the kit) are not its own.
 */
function releaseHeld(room: Room, keep: ReadonlySet<Texture>, used: InUse): void {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if ((value as Texture).isTexture) {
      if (!keep.has(value as Texture) && !used.textures.has(value as Texture)) (value as Texture).dispose();
      return;
    }
    if ((value as RenderTarget).isRenderTarget) {
      if (!used.textures.has((value as RenderTarget).texture)) (value as RenderTarget).dispose();
      return;
    }
    if (depth === 0) return;
    if (Array.isArray(value)) for (const v of value) visit(v, depth - 1);
    else if (Object.getPrototypeOf(value) === Object.prototype) for (const v of Object.values(value)) visit(v, depth - 1);
  };
  for (const v of Object.values(room)) visit(v, 2);
}

/**
 * What makes a journey of half an hour possible: nothing is in memory longer than it is needed. It fetches
 * what the next step needs while the viewer is still in this one, builds it under the cut to black, holds
 * the cut for as long as that takes, and drops what lies behind. The dream does not go back past a cut.
 */
export class JourneyDirector {
  readonly sound: RoomSound;
  /** How far the picture is covered by the cut (0..1), and with what. */
  cover = 0;
  coverWhite = false;
  /** The timeline may move between these. */
  readonly bounds: [number, number] = [0, 1];
  /** What the shutter has kept. */
  readonly album = new Album();
  /** The room asked for the shutter: the piece takes the picture once this frame has been drawn. */
  shutterAsked = false;
  /** Where the timeline must jump to: a room that could not be had (a lost connection) is passed over in the dark. */
  jump: number | null = null;

  private readonly rooms = new Map<string, { state: State; file?: RoomFile; room?: Room; fetched?: Promise<void>; built?: Promise<void> }>();
  private current = -1;
  /** Files the walk and the opening use: they are never released with a room. */
  private readonly protectedFiles: ReadonlySet<string>;
  /** The copies of files that rooms loaded, by key (each fetch loads its own copy: see sweepCopies). */
  private readonly roomCopies = new Map<GLTF | MaterialMaps, string>();

  constructor(
    private readonly assets: Assets,
    private readonly dream: DreamDirector,
    audio: AudioEngine,
    private readonly compile: (root: Group) => Promise<void>,
    private readonly stage: RoomStage,
    private readonly uniformsOf: UniformsOf,
  ) {
    this.sound = new RoomSound(audio);
    this.protectedFiles = new Set([...assets.models.keys(), ...assets.materials.keys(), ...dream.walkFiles]);
  }

  private roomSlot(id: string) {
    let slot = this.rooms.get(id);
    if (!slot) {
      slot = { state: 'none' };
      this.rooms.set(id, slot);
    }
    return slot;
  }

  /** Bring a room's files in. */
  private fetchRoom(id: string): Promise<void> {
    const slot = this.roomSlot(id);
    if (!slot.fetched) {
      slot.state = 'fetching';
      slot.fetched = (async () => {
        const load = FILES[`./list/${roomFile(id)}.ts`];
        if (!load) throw new Error(`no such room: ${id}`);
        const file = await load();
        slot.file = file;
        const a = file.assets ?? {};
        const [models, materials] = await Promise.all([
          Promise.all((a.models ?? []).map((k) => this.assets.model(k, `${k}.glb`))),
          Promise.all((a.materials ?? []).map((k) => this.assets.material(k, k))),
          this.sound.load(a.sounds ?? []),
        ]);
        models.forEach((gltf, i) => this.roomCopies.set(gltf, a.models![i]));
        materials.forEach((maps, i) => this.roomCopies.set(maps, a.materials![i]));
        slot.state = 'fetched';
      })().catch((reason) => {
        console.error(`room ${id} could not be fetched`, reason);
        slot.state = 'failed';
      });
    }
    return slot.fetched;
  }

  /** Build a room and its shaders. */
  private buildRoom(id: string): Promise<void> {
    const slot = this.roomSlot(id);
    if (!slot.built) {
      slot.built = (async () => {
        await this.fetchRoom(id);
        if (slot.state === 'failed') return;
        slot.state = 'building';
        await breathe();
        const index = JOURNEY.findIndex((s) => isRoom(s) && s.room === id);
        const room = new slot.file!.default({
          kit: this.dream.kit,
          sound: this.sound,
          origin: new Vector3(ROOM_SPACE + (index % ROOM_SLOTS) * ROOM_STEP, 0, 0),
          id,
          visit: roomVisit(id),
          seconds: JOURNEY[index].seconds,
          album: this.album,
          say: this.stage.say,
          hint: this.stage.hint,
          shutter: () => (this.shutterAsked = true),
        });
        this.dream.adoptRoom(room);
        // what a room shows only later must still have its shader now, under the cut, not mid-scene
        const hidden: Object3D[] = [];
        room.root.traverse((o) => {
          if (!o.visible) hidden.push(o);
        });
        for (const o of hidden) o.visible = true;
        await this.compile(room.root);
        for (const o of hidden) o.visible = false;
        room.develop?.(this.dream.picture);
        slot.room = room;
        slot.state = 'ready';
      })().catch((reason) => {
        console.error(`room ${id} could not be built`, reason);
        slot.state = 'failed';
      });
    }
    return slot.built;
  }

  private dropRoom(id: string): void {
    const slot = this.rooms.get(id);
    if (!slot) return;
    if (!slot.room) {
      // fetched (or failed) and never built: it goes with its files like any other; one whose files or build are
      // still on their way goes at a later step, once they have come
      if (slot.state === 'fetching' || slot.state === 'building') return;
      this.rooms.delete(id);
      this.forgetFiles(id, slot.file?.assets);
      return;
    }
    // the whole scene it hangs in: what is still alive after it
    let scene: Object3D = slot.room.root;
    while (scene.parent) scene = scene.parent;
    this.dream.dropRoom(slot.room);
    slot.room.dispose();
    const keep = this.loadedTextures();
    const used = inUse(scene, this.uniformsOf);
    release(slot.room.root, keep, this.uniformsOf, used);
    releaseHeld(slot.room, keep, used);
    this.rooms.delete(id);
    this.forgetFiles(id, slot.file?.assets);
    this.sweepCopies(used);
  }

  /**
   * Every fetch loads its own copy of a file, and the newest copy is the one its key gives: what a room built is
   * made of its copy, or of a newer one. A copy a room loaded that nothing alive shows any more leaves the GPU (its
   * own room is gone, and neither the walk nor another room draws with its shapes, materials or pictures):
   * forgotten if a newer copy has taken its key, kept loaded (and uploaded again if it is ever drawn) while the walk
   * or a coming room may still build from it. What FigureKit keeps for bodies that look alike, the maps it painted
   * and the poses it baked, goes the same way once no one alive wears or stands in them.
   */
  private sweepCopies(used: InUse): void {
    const none = () => undefined;
    for (const [copy, key] of this.roomCopies) {
      const model = 'scene' in copy;
      let drawn = false;
      if (model) {
        copy.scene.traverse((o) => (drawn ||= used.geometries.has((o as Mesh).geometry)));
        materialsUnder(copy.scene, (m) => (drawn ||= used.materials.has(m)));
        materialsUnder(copy.scene, (m) => picturesOf(m, none, (t) => (drawn ||= used.sources.has(t.source))));
      } else drawn = [copy.map, copy.normalMap, copy.ormMap].some((t) => used.sources.has(t.source));
      if (drawn) continue;
      if (model) this.assets.freeModel(copy);
      else this.assets.freeMaterial(copy);
      if ((model ? this.assets.models.get(key) : this.assets.materials.get(key)) !== copy) this.roomCopies.delete(copy);
    }
    const figures = this.dream.kit.figures;
    for (const t of figures.painted()) if (!used.sources.has(t.source)) t.dispose();
    for (const g of figures.bakedGeometries()) if (!used.geometries.has(g)) g.dispose();
  }

  /** Textures of every file in memory (they outlive a room that shows them). */
  private loadedTextures(): Set<Texture> {
    const keep = new Set<Texture>();
    for (const maps of this.assets.materials.values()) keep.add(maps.map).add(maps.normalMap).add(maps.ormMap);
    for (const gltf of this.assets.models.values()) {
      gltf.scene.traverse((o) => {
        const material = (o as Mesh).material as Material | Material[] | undefined;
        for (const m of Array.isArray(material) ? material : material ? [material] : []) {
          for (const value of Object.values(m)) if ((value as Texture | null)?.isTexture) keep.add(value as Texture);
        }
      });
    }
    return keep;
  }

  /** What only this room needed goes too: files of the ones around it, and of the walk, stay. */
  private forgetFiles(id: string, assets: RoomAssets | undefined): void {
    const needed = new Set<string>();
    const sounds = new Set<string>();
    for (const [other, slot] of this.rooms) {
      if (other === id) continue;
      for (const k of [...(slot.file?.assets?.models ?? []), ...(slot.file?.assets?.materials ?? [])]) needed.add(k);
      for (const s of slot.file?.assets?.sounds ?? []) sounds.add(s);
    }
    this.sound.forget(sounds);
    for (const k of assets?.models ?? []) if (!needed.has(k) && !this.protectedFiles.has(k)) this.assets.releaseModel(k);
    for (const k of assets?.materials ?? []) if (!needed.has(k) && !this.protectedFiles.has(k)) this.assets.releaseMaterial(k);
  }

  /** Set pieces of the walk this step passes through. */
  private fetchWalk(step: WalkStep): Promise<void> {
    return this.dream.fetchPieces(step.walk);
  }

  /** The step, built. */
  private prepared(index: number): boolean {
    const step = JOURNEY[index];
    if (!step) return true;
    if (isRoom(step)) return this.roomSlot(step.room).state === 'ready' || this.roomSlot(step.room).state === 'failed';
    return this.dream.piecesReady(step.walk);
  }

  private fetchStep(index: number): void {
    const step = JOURNEY[index];
    if (!step) return;
    if (isRoom(step)) void this.fetchRoom(step.room);
    else void this.fetchWalk(step);
  }

  private buildStep(index: number): void {
    const step = JOURNEY[index];
    if (!step) return;
    if (isRoom(step)) void this.buildRoom(step.room);
    else void this.dream.buildPieces(step.walk, this.compile);
  }

  /** What the journey is at `p` now: called every frame before anything else of the dream. */
  update(p: number): Room | null {
    const inJourney = p >= phaseStart('WORLD') && p < phaseStart('EXPLORATION');
    const placed = stepAt(p);
    const index = inJourney ? placed.index : p < phaseStart('WORLD') ? -1 : JOURNEY.length;
    if (index !== this.current) {
      // what lies behind is dropped: the dream does not go back past a cut
      for (const [id] of this.rooms) {
        const i = JOURNEY.findIndex((s) => isRoom(s) && s.room === id);
        if (i < index || i > index + 1) this.dropRoom(id);
      }
      this.current = index;
      const step = JOURNEY[index];
      this.sound.levelFor(step && isRoom(step) ? step.room : null);
    }
    const next = index + 1;
    const nextStart = next < JOURNEY_STEPS.length ? JOURNEY_STEPS[next].from : phaseStart('EXPLORATION');

    // the way to the next step
    if (index >= 0 && next < JOURNEY.length) {
      if (nextStart - p < FETCH_AHEAD) this.fetchStep(next);
      if (nextStart - p < BUILD_AHEAD) this.buildStep(next);
    } else if (index < 0 && phaseStart('WORLD') - p < FETCH_AHEAD) {
      this.fetchStep(0);
      this.buildStep(0);
    }
    if (index >= 0 && index < JOURNEY.length && !this.prepared(index)) this.buildStep(index);

    const here = index >= 0 && index < JOURNEY.length ? JOURNEY[index] : null;
    this.jump = here && isRoom(here) && this.roomSlot(here.room).state === 'failed' ? placed.to + 1e-6 : null;

    // no going back past the last cut; no going on until the next step exists
    const readyHere = index < 0 || index >= JOURNEY.length || this.prepared(index);
    const readyNext = next >= JOURNEY.length || this.prepared(next);
    this.bounds[0] = index > 0 ? placed.from : 0;
    if (index >= 0 && index < JOURNEY.length) this.bounds[1] = readyNext ? 1 : nextStart - at(0.02);
    else if (index < 0) this.bounds[1] = readyNext && this.prepared(0) ? 1 : phaseStart('WORLD') - at(0.02);
    else this.bounds[1] = 1;

    // the cut
    let cover = 0;
    let white = false;
    if (index >= 0 && index < JOURNEY.length) {
      const nextCut: Cut = JOURNEY[next]?.cut ?? 'black';
      const thisCut: Cut = JOURNEY[index].cut ?? 'black';
      if (!readyHere) cover = 1;
      if (next < JOURNEY.length && nextCut !== 'none') {
        const span = nextCut === 'flash' ? FLASH_OUT : CUT_OUT;
        const out = 1 - Math.min(1, (nextStart - p) / span);
        if (out > cover) {
          cover = out;
          white = nextCut === 'flash';
        }
      }
      if (index > 0 && thisCut !== 'none') {
        const span = thisCut === 'flash' ? FLASH_IN : CUT_IN;
        const into = 1 - Math.min(1, (p - placed.from) / span);
        if (into > cover) {
          cover = into;
          white = thisCut === 'flash';
        }
      }
    }
    this.cover = cover;
    this.coverWhite = white;

    const running = roomAt(p);
    return running && this.rooms.get(running.id)?.state === 'ready' ? (this.rooms.get(running.id)!.room ?? null) : null;
  }

  /** For tools: the step at the current place is not ready yet. */
  buildingNow(): boolean {
    return this.current >= 0 && this.current < JOURNEY.length && !this.prepared(this.current);
  }

  /** Back at the start: only what the first minutes need stays. */
  reset(): void {
    for (const [id] of this.rooms) this.dropRoom(id);
    this.current = -1;
    this.album.clear();
  }

  /** The piece's opening: what must exist before the title lets you in. */
  async prepareOpening(): Promise<void> {
    const first = JOURNEY[0];
    if (first && !isRoom(first)) await this.dream.buildPieces(first.walk, this.compile);
  }

  /** Development: build one room at once. */
  async prepareRoom(id: string): Promise<void> {
    await this.buildRoom(id);
  }
}
