import {
  DataTexture,
  LoadingManager,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export interface MaterialMaps {
  map: Texture;
  normalMap: Texture;
  /** ORM packed: R = ambient occlusion, G = roughness, B = metalness. */
  ormMap: Texture;
}

/**
 * Loads everything the piece needs before it starts (the experience is one continuous shot,
 * so nothing may pop in later). Reports progress for the title screen.
 */
export class Assets {
  private readonly manager = new LoadingManager();
  private readonly gltf = new GLTFLoader(this.manager);
  private readonly textures = new TextureLoader(this.manager);
  private readonly hdr = new HDRLoader(this.manager);
  readonly models = new Map<string, GLTF>();
  readonly materials = new Map<string, MaterialMaps>();
  readonly environments = new Map<string, DataTexture>();
  readonly failed: string[] = [];
  loaded = 0;
  total = 0;

  constructor(private readonly base: string) {
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
    this.manager.onProgress = (_url, loaded, total) => {
      this.loaded = loaded;
      this.total = total;
    };
    this.manager.onError = (url) => this.failed.push(url);
  }

  get fraction(): number {
    return this.total ? this.loaded / this.total : 0;
  }

  async model(key: string, file: string): Promise<GLTF> {
    const gltf = await this.gltf.loadAsync(`${this.base}models/${file}`);
    this.models.set(key, gltf);
    return gltf;
  }

  /** A PBR set exported as <name>_color.webp, <name>_normal.webp, <name>_orm.webp. */
  async material(key: string, name: string): Promise<MaterialMaps> {
    const load = (suffix: string) => this.textures.loadAsync(`${this.base}textures/${name}_${suffix}.webp`);
    const [map, normalMap, ormMap] = await Promise.all([load('color'), load('normal'), load('orm')]);
    map.colorSpace = SRGBColorSpace;
    for (const t of [map, normalMap, ormMap]) {
      t.wrapS = t.wrapT = RepeatWrapping;
      t.anisotropy = 4;
    }
    const maps = { map, normalMap, ormMap };
    this.materials.set(key, maps);
    return maps;
  }

  async environment(key: string, file: string): Promise<DataTexture> {
    const t = await this.hdr.loadAsync(`${this.base}hdri/${file}`);
    this.environments.set(key, t);
    return t;
  }
}
