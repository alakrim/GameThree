import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Mats, boxUV } from './materials.js';
import { makeFire } from './fire.js';
import { PALETTE, teamColor, teamBanner } from './palette.js';
import { toWorld } from './terrain.js';

let towerGeo: { stone: THREE.BufferGeometry; wood: THREE.BufferGeometry } | null = null;
function towerParts() {
  if (towerGeo) return towerGeo;
  const base = boxUV(new THREE.CylinderGeometry(1.35, 1.7, 1.2, 10).translate(0, 0.6, 0), 0.4);
  const shaft = boxUV(new THREE.CylinderGeometry(1.15, 1.35, 5.4, 10).translate(0, 3.9, 0), 0.4);
  const crown = boxUV(new THREE.CylinderGeometry(1.6, 1.4, 0.7, 10).translate(0, 6.95, 0), 0.4);
  const merlons: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    merlons.push(boxUV(new THREE.BoxGeometry(0.5, 0.6, 0.35).translate(0, 0, 1.45).rotateY(a).translate(0, 7.6, 0), 0.4));
  }
  const stone = mergeGeometries([base, shaft, crown, ...merlons])!;
  const posts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) posts.push(boxUV(new THREE.BoxGeometry(0.16, 1.6, 0.16).translate(1.05, 8.1, 0).rotateY((i / 4) * Math.PI * 2 + Math.PI / 4), 0.6));
  const roof = new THREE.ConeGeometry(1.75, 1.3, 10).translate(0, 9.5, 0);
  const wood = mergeGeometries([...posts, roof].map((g) => { g.deleteAttribute('uv'); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2)); return g; }))!;
  towerGeo = { stone, wood };
  return towerGeo;
}

/** A defensive watchtower (gameplay structure): slate shaft, timber lookout, brazier, clan pennant, health bar. */
export class StructureView {
  readonly root = new THREE.Group();
  private bar = new THREE.Group(); private fill: THREE.Mesh;
  private sink = -1;
  constructor(readonly id: number, readonly team: 0 | 1, readonly kind: 'tower' | 'heart', ally: boolean) {
    if (kind === 'tower') {
      const { stone, wood } = towerParts();
      const s = new THREE.Mesh(stone, Mats.slate(1)); s.castShadow = s.receiveShadow = true;
      const w = new THREE.Mesh(wood, Mats.timber()); w.castShadow = true;
      const fire = makeFire(0.9); fire.position.y = 7.35;
      const light = new THREE.PointLight(PALETTE.fire, 10, 16, 1.8); light.position.y = 8;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.37, 1.37, 0.35, 10, 1, true).translate(0, 5.6, 0), new THREE.MeshStandardMaterial({ color: teamBanner(team), emissive: teamColor(team), emissiveIntensity: 0.25, side: THREE.DoubleSide, roughness: 0.9 }));
      this.root.add(s, w, fire, light, band);
    }
    const W = kind === 'heart' ? 3 : 2.2;
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.06, 0.2), new THREE.MeshBasicMaterial({ color: 0x0b0b0e, depthTest: false, transparent: true, opacity: 0.75 }));
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.14).translate(W / 2, 0, 0), new THREE.MeshBasicMaterial({ color: ally ? teamColor(team) : PALETTE.hostile, depthTest: false }));
    this.fill.position.set(-W / 2, 0, 0.001);
    bg.renderOrder = 20; this.fill.renderOrder = 21;
    this.bar.add(bg, this.fill); this.bar.position.y = kind === 'heart' ? 7 : 11;
    this.root.add(this.bar);
  }
  place(x: number, y: number, ground: number, hpFrac: number, invulnerable: boolean, cam: THREE.Camera) {
    if (this.sink < 0) this.root.position.copy(toWorld(x, y, ground));
    this.fill.scale.x = Math.max(0.001, hpFrac);
    (this.fill.material as THREE.MeshBasicMaterial).opacity = invulnerable ? 0.45 : 1;
    (this.fill.material as THREE.MeshBasicMaterial).transparent = invulnerable;
    const d = cam.position.distanceTo(this.root.position);
    this.bar.visible = d < 60 && this.sink < 0;
    this.bar.quaternion.copy(cam.quaternion);
    this.bar.scale.setScalar(THREE.MathUtils.clamp(d / 16, 0.8, 2.4));
  }
  /** Collapse animation when destroyed; returns false when finished. */
  collapse(dt: number): boolean {
    if (this.sink < 0) this.sink = 0;
    this.sink += dt;
    this.root.position.y -= dt * 4.5 * Math.min(1, this.sink);
    this.root.rotation.z = Math.sin(this.sink * 9) * 0.03;
    return this.sink < 2.2;
  }
}
