import * as THREE from 'three';
import { Character } from './character.js';
import { PALETTE, teamColor } from './palette.js';
import { toWorld } from './terrain.js';

const BAR_RANGE = 40;

/** A networked unit: character model + overhead health bar, placed on the terrain. */
export class UnitView {
  readonly root = new THREE.Group();
  readonly character: Character;
  private bar = new THREE.Group();
  private fill: THREE.Mesh;
  private yaw = 0;
  private last = new THREE.Vector3();
  private speed = 0;
  constructor(readonly id: number, readonly team: 0 | 1, readonly isHero: boolean, ally: boolean, readonly isLocal: boolean) {
    this.character = new Character({ team, role: isHero ? 'hero' : 'minion' });
    this.root.add(this.character.root);
    const w = isHero ? 1.0 : 0.6, h = isHero ? 0.09 : 0.06;
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.04, h + 0.04), new THREE.MeshBasicMaterial({ color: 0x0b0b0e, depthTest: false, transparent: true, opacity: 0.75 }));
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(w, h).translate(w / 2, 0, 0), new THREE.MeshBasicMaterial({ color: ally ? teamColor(team) : PALETTE.hostile, depthTest: false }));
    this.fill.position.set(-w / 2, 0, 0.001);
    bg.renderOrder = 20; this.fill.renderOrder = 21;
    this.bar.add(bg, this.fill);
    this.bar.position.y = isHero ? 2.45 : 1.95;
    this.bar.visible = !isLocal; // local player's health lives on the HUD
    this.root.add(this.bar);
  }

  /** x/y are sim coords; ground height from terrain; facing in sim radians. */
  place(x: number, y: number, ground: number, facing: number, hpFrac: number, cam: THREE.Camera, dt: number) {
    const p = toWorld(x, y, ground);
    if (dt > 0) {
      const inst = Math.hypot(p.x - this.last.x, p.z - this.last.z) / dt;
      this.speed += (Math.min(inst, 12) - this.speed) * Math.min(1, dt * 12);
    }
    this.last.copy(p);
    this.root.position.copy(p);
    const target = facing + Math.PI / 2; // model faces +z
    let d = target - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 12);
    this.character.root.rotation.y = this.yaw;
    this.character.update(this.speed, dt);
    this.fill.scale.x = Math.max(0.001, hpFrac);
    if (!this.isLocal) {
      const dist = cam.position.distanceTo(p);
      this.bar.visible = dist < BAR_RANGE;
      this.bar.quaternion.copy(cam.quaternion);
      const s = THREE.MathUtils.clamp(dist / 14, 0.6, 1.8); this.bar.scale.setScalar(s);
    }
  }
}
