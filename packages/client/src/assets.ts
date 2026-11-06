import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** Central asset loading with progress reporting (drives the loading screen). */
export const manager = new THREE.LoadingManager();
const tex = new THREE.TextureLoader(manager);
const gltf = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
const rgbe = new RGBELoader(manager);
const BASE = `${import.meta.env.BASE_URL}assets/`;

export interface PbrSet { color: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture }

const cache = new Map<string, PbrSet>();
/** Load (or reuse) a PBR set. Each distinct `repeat` gets its own textures: clones share image data but not upload state. */
export function pbr(name: string, anisotropy = 8, repeat = 1): PbrSet {
  const key = `${name}@${repeat}`;
  let s = cache.get(key);
  if (s) return s;
  const load = (f: string, srgb: boolean) => {
    const t = tex.load(`${BASE}textures/${name}/${f}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.setScalar(repeat);
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  s = { color: load('color', true), normal: load('normal', false), rough: load('rough', false) };
  cache.set(key, s);
  return s;
}

export const loadModel = (id: string): Promise<GLTF> => gltf.loadAsync(`${BASE}models/${id}.glb`);
export const loadHdr = (): Promise<THREE.DataTexture> => rgbe.loadAsync(`${BASE}hdri/sky_1k.hdr`);
export const loadSkyBackground = (): Promise<THREE.Texture> => tex.loadAsync(`${BASE}hdri/sky_bg.jpg`);

/**
 * Bake a glTF scene into a single geometry + material list, normalised so the base sits on y=0,
 * centred on x/z and scaled so the largest horizontal extent is 1. Ready for InstancedMesh.
 */
export function bakeModel(g: GLTF): { geometry: THREE.BufferGeometry; material: THREE.Material; height: number } {
  g.scene.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  let material: THREE.Material | null = null;
  g.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    geos.push(geo.index ? geo : geo);
    material ??= Array.isArray(m.material) ? m.material[0]! : m.material;
  });
  const geometry = geos.length === 1 ? geos[0]! : mergeSimple(geos);
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const size = new THREE.Vector3(); bb.getSize(size);
  const s = 1 / Math.max(size.x, size.z);
  geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geometry.scale(s, s, s);
  geometry.computeBoundingSphere();
  return { geometry, material: material!, height: size.y * s };
}

function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Small inline merge (indexed) to avoid pulling BufferGeometryUtils for one use.
  const out = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'uv'] as const;
  const arrays: Record<string, number[]> = { position: [], normal: [], uv: [] };
  const index: number[] = [];
  let offset = 0;
  for (const g of geos) {
    const n = g.attributes.position!.count;
    for (const a of attrs) { const at = g.getAttribute(a); if (at) for (let i = 0; i < at.count * at.itemSize; i++) arrays[a]!.push(at.array[i] as number); else for (let i = 0; i < n * (a === 'uv' ? 2 : 3); i++) arrays[a]!.push(0); }
    if (g.index) for (let i = 0; i < g.index.count; i++) index.push(g.index.getX(i) + offset); else for (let i = 0; i < n; i++) index.push(i + offset);
    offset += n;
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(arrays.position!, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(arrays.normal!, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(arrays.uv!, 2));
  out.setIndex(index);
  return out;
}
