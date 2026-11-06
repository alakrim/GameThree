import * as THREE from 'three';

/**
 * Splits a large instance set into spatial cells so each cell is its own InstancedMesh:
 * frustum culling (including the shadow pass) then skips everything off-screen.
 */
export function chunkedInstances(
  geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], cell: number,
  opts: { castShadow?: boolean; receiveShadow?: boolean; depthMat?: THREE.Material } = {},
): THREE.Group {
  const g = new THREE.Group();
  const buckets = new Map<string, THREE.Matrix4[]>();
  const p = new THREE.Vector3();
  for (const m of mats) {
    p.setFromMatrixPosition(m);
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    let b = buckets.get(k); if (!b) buckets.set(k, (b = [])); b.push(m);
  }
  for (const list of buckets.values()) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    im.castShadow = opts.castShadow ?? false;
    im.receiveShadow = opts.receiveShadow ?? true;
    if (opts.depthMat) im.customDepthMaterial = opts.depthMat;
    g.add(im);
  }
  return g;
}

export const mat4 = (x: number, y: number, z: number, rotY: number, sx: number, sy = sx, sz = sx, tiltX = 0, tiltZ = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, rotY, tiltZ)), new THREE.Vector3(sx, sy, sz));
