import * as THREE from 'three';
import { pbr } from '../assets.js';

/** Shared PBR material library. One instance per look => shader/program reuse and fewer state changes. */
const lib = new Map<string, THREE.MeshStandardMaterial>();

function make(key: string, tex: string, opts: { repeat?: number; tint?: THREE.ColorRepresentation; metalness?: number; roughness?: number; normalScale?: number; side?: THREE.Side }) {
  let m = lib.get(key);
  if (m) return m;
  const s = pbr(tex, 8, opts.repeat ?? 1);
  m = new THREE.MeshStandardMaterial({
    map: s.color, normalMap: s.normal, roughnessMap: s.rough,
    color: opts.tint ?? 0xffffff, metalness: opts.metalness ?? 0, roughness: opts.roughness ?? 1,
    normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1), side: opts.side ?? THREE.FrontSide,
  });
  lib.set(key, m);
  return m;
}

export const Mats = {
  steel: () => make('steel', 'steel', { repeat: 1, metalness: 1, roughness: 0.75, tint: 0xb9bcc2 }),
  darkSteel: () => make('darkSteel', 'steel', { repeat: 1, metalness: 1, roughness: 0.9, tint: 0x5a5c62 }),
  leather: () => make('leather', 'leather', { repeat: 2, tint: 0x5a3a26, roughness: 1 }),
  cloth: (team: 0 | 1, color: number) => make(`cloth${team}`, 'cloth', { repeat: 2, tint: color, roughness: 1, side: THREE.DoubleSide }),
  fur: () => make('fur', 'forest', { repeat: 1, tint: 0x8a7a66, roughness: 1, normalScale: 2 }),
  bark: () => make('bark', 'bark', { repeat: 1, roughness: 1 }),
  timber: () => make('timber', 'timber', { repeat: 1, tint: 0x8a7766, roughness: 1 }),
  slate: (repeat = 1) => make(`slate${repeat}`, 'slate', { repeat, tint: 0xa4a29c, roughness: 1, normalScale: 1.4 }),
  cobble: (repeat = 1) => make(`cobble${repeat}`, 'cobble', { repeat, tint: 0xa8a49c, roughness: 1 }),
  rock: (repeat = 1) => make(`rock${repeat}`, 'rock', { repeat, roughness: 1, normalScale: 1.3 }),
  skin: () => plain('skin', { color: 0xc89878, roughness: 0.8 }),
  hair: () => plain('hair', { color: 0x8a5a2a, roughness: 0.9 }),
  fletch: () => plain('fletch', { color: 0xd8d6cf, roughness: 1, side: THREE.DoubleSide }),
  brass: () => make('brass', 'steel', { repeat: 1, metalness: 1, roughness: 0.45, tint: 0xd4a050 }),
};

/** Untextured shared material (small details where a texture would be sub-pixel anyway). */
function plain(key: string, o: THREE.MeshStandardMaterialParameters) {
  let m = lib.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial(o); lib.set(key, m); }
  return m;
}

/** Planar world-space UVs for procedural meshes (so textures keep a constant texel density). */
export function boxUV(geo: THREE.BufferGeometry, scale = 1): THREE.BufferGeometry {
  const p = geo.attributes.position!, n = geo.attributes.normal!;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
