import * as THREE from 'three';
import { toonMaterial, inked } from './toon.js';
import { PALETTE, teamColor, teamHi } from './palette.js';
import { toWorld } from './arena.js';
import type { InterpEntity } from '../net/interp.js';

/**
 * Unit views. Graybox hero: proportions, silhouette and signature-shape slot follow Art Bible §6;
 * real hero meshes (glTF) replace `buildHeroBody` per archetype once the roster is locked.
 */
abstract class UnitView {
  readonly root = new THREE.Group();
  protected body = new THREE.Group();
  private hpFill: THREE.Mesh;
  private hpGroup = new THREE.Group();
  protected phase = Math.random() * 10;
  constructor(readonly id: number, readonly team: 0 | 1, hpWidth: number, hpY: number, isHero: boolean, ally: boolean) {
    this.root.add(this.body);
    const blob = new THREE.Mesh(new THREE.CircleGeometry(isHero ? 0.95 : 0.6, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; this.root.add(blob);
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(hpWidth + 0.08, isHero ? 0.26 : 0.16), new THREE.MeshBasicMaterial({ color: PALETTE.ink, depthTest: false }));
    this.hpFill = new THREE.Mesh(new THREE.PlaneGeometry(hpWidth, isHero ? 0.18 : 0.1), new THREE.MeshBasicMaterial({ color: ally ? teamColor(team) : PALETTE.hostile, depthTest: false }));
    this.hpFill.geometry.translate(hpWidth / 2, 0, 0); this.hpFill.position.x = -hpWidth / 2; this.hpFill.position.z = 0.001;
    bg.renderOrder = 10; this.hpFill.renderOrder = 11;
    this.hpGroup.add(bg, this.hpFill); this.hpGroup.position.y = hpY; this.root.add(this.hpGroup);
  }
  apply(e: InterpEntity, cam: THREE.Camera, dt: number) {
    this.root.position.copy(toWorld(e.x, e.y));
    // Smoothly turn toward facing (sim facing is CCW from +x in sim space => rotation.y).
    const target = e.f;
    let d = target - this.body.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.body.rotation.y += d * Math.min(1, dt * 14);
    this.hpFill.scale.x = Math.max(0.001, e.hp / e.mh);
    this.hpGroup.quaternion.copy(cam.quaternion);
    this.animate(e.speed, dt);
  }
  protected abstract animate(speed: number, dt: number): void;
}

export class HeroView extends UnitView {
  private torso: THREE.Object3D; private lantern: THREE.Object3D; private head: THREE.Object3D;
  constructor(id: number, team: 0 | 1, ally: boolean, isLocal: boolean, outlines: boolean) {
    super(id, team, 1.6, 4.0, true, ally);
    const c = teamColor(team), hi = teamHi(team);
    const lacquer = toonMaterial({ color: team === 0 ? 0x8a3a2a : 0x2a4a6a, rim: hi, rimStrength: 0.55 });
    const trim = toonMaterial({ color: c, rim: hi, rimStrength: 0.6 });
    const skin = toonMaterial({ color: 0xe8c7a0, rim: hi, rimStrength: 0.3 });
    this.torso = inked(new THREE.CapsuleGeometry(0.48, 0.7, 4, 12), lacquer, 0.06, outlines); this.torso.position.y = 1.15;
    const cloak = inked(new THREE.ConeGeometry(0.78, 1.25, 10, 1, true), trim, 0.05, outlines); cloak.position.y = 0.72;
    this.head = inked(new THREE.SphereGeometry(0.42, 16, 12), skin, 0.06, outlines); this.head.position.y = 2.05;
    const hat = inked(new THREE.ConeGeometry(0.62, 0.42, 12), trim, 0.05, outlines); hat.position.y = 2.42;
    const staff = inked(new THREE.CylinderGeometry(0.06, 0.07, 2.3, 6), toonMaterial({ color: 0x4a3226 }), 0.04, outlines); staff.position.set(0.15, 1.2, 0.62);
    // Signature shape slot: a floating lantern, repeated in VFX + icon (Art Bible §6).
    this.lantern = inked(new THREE.OctahedronGeometry(0.28, 0), toonMaterial({ color: hi, emissive: c, emissiveIntensity: 1.2 }), 0.05, outlines);
    this.lantern.position.set(0.15, 2.5, 0.62);
    this.body.add(this.torso, cloak, this.head, hat, staff, this.lantern);
    this.body.scale.setScalar(1.35); // readability: hero silhouette >= 64px on phones (Art Bible §3)
    if (isLocal) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.22, 40), new THREE.MeshBasicMaterial({ color: hi, transparent: true, opacity: 0.85, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; this.root.add(ring);
    }
  }
  protected animate(speed: number, dt: number) {
    const moving = speed > 0.5;
    this.phase += dt * (moving ? 11 : 2.2);
    const bob = moving ? Math.abs(Math.sin(this.phase)) * 0.14 : Math.sin(this.phase) * 0.03;
    this.torso.position.y = 1.15 + bob; this.head.position.y = 2.05 + bob * 1.1;
    this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, 0, dt * 8);
    this.torso.rotation.z = THREE.MathUtils.lerp(this.torso.rotation.z, moving ? -0.18 : 0, dt * 10); // forward lean
    this.lantern.position.y = 2.5 + Math.sin(this.phase * 0.5) * 0.12;
    this.lantern.rotation.y += dt * 2;
  }
}

export class MinionView extends UnitView {
  private shell: THREE.Object3D;
  constructor(id: number, team: 0 | 1, ally: boolean, outlines: boolean) {
    super(id, team, 0.9, 1.6, false, ally);
    const c = teamColor(team);
    this.shell = inked(new THREE.CylinderGeometry(0.32, 0.42, 0.75, 8), toonMaterial({ color: team === 0 ? 0xb5763a : 0x3c8a90, rim: teamHi(team), rimStrength: 0.4 }), 0.04, outlines);
    this.shell.position.y = 0.55;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: c === PALETTE.dawn ? PALETTE.dawnHi : PALETTE.duskHi }));
    eye.position.set(0.3, 0.7, 0);
    const cap = inked(new THREE.ConeGeometry(0.38, 0.35, 8), toonMaterial({ color: c }), 0.04, outlines); cap.position.y = 1.08;
    this.body.add(this.shell, eye, cap);
    this.body.scale.setScalar(1.2);
  }
  protected animate(speed: number, dt: number) {
    this.phase += dt * (speed > 0.3 ? 14 : 2);
    this.body.position.y = speed > 0.3 ? Math.abs(Math.sin(this.phase)) * 0.12 : 0;
  }
}

/** Click-to-move feedback: contracting ring, shown instantly to hide network latency. */
export class MoveMarker {
  readonly mesh: THREE.Mesh;
  private t = 1;
  constructor(color: number) {
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    this.mesh.rotation.x = -Math.PI / 2; this.mesh.visible = false;
  }
  show(p: THREE.Vector3) { this.mesh.position.set(p.x, p.y + 0.08, p.z); this.t = 0; this.mesh.visible = true; }
  update(dt: number) {
    if (this.t >= 1) { this.mesh.visible = false; return; }
    this.t = Math.min(1, this.t + dt * 2.2);
    const s = 1.6 - this.t * 1.1;
    this.mesh.scale.set(s, s, s);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - this.t;
  }
}
