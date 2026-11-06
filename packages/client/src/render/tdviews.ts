import * as THREE from 'three';
import { BULWARK_TYPES, BULWARKS, type BulwarkType } from '@lumen/shared';
import { buildBulwarkModel, buildWolf } from './bulwarks.js';
import { PALETTE, teamColor } from './palette.js';
import { toWorld } from './terrain.js';

function healthBar(width: number, ally: boolean, team: 0 | 1) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.05, 0.16), new THREE.MeshBasicMaterial({ color: 0x0b0b0e, depthTest: false, transparent: true, opacity: 0.75 }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.11).translate(width / 2, 0, 0), new THREE.MeshBasicMaterial({ color: ally ? teamColor(team) : PALETTE.hostile, depthTest: false }));
  fill.position.set(-width / 2, 0, 0.001);
  bg.renderOrder = 20; fill.renderOrder = 21;
  g.add(bg, fill);
  return { g, fill };
}

/** Player-built structure: model per level, turret aims at its current target, frost glow pulses, health bar. */
export class BulwarkView {
  readonly root = new THREE.Group();
  readonly type: BulwarkType;
  private model: THREE.Group | null = null;
  private level = 0;
  private bar: THREE.Group; private fill: THREE.Mesh;
  private yaw = 0; private targetYaw = 0;
  private t = Math.random() * 10;
  private sinking = -1;
  constructor(readonly id: number, readonly team: 0 | 1, typeIndex: number, readonly ally: boolean, readonly owner: string | undefined) {
    this.type = BULWARK_TYPES[typeIndex] ?? 'arrow';
    const hb = healthBar(1.6, ally, team); this.bar = hb.g; this.fill = hb.fill;
    this.bar.visible = this.type !== 'spikes';
    this.root.add(this.bar);
  }
  get turret(): THREE.Object3D | undefined { return this.model?.userData.turret as THREE.Object3D | undefined; }
  get muzzle(): THREE.Vector3 {
    const m = this.model?.userData.muzzle as THREE.Object3D | undefined;
    return m ? m.getWorldPosition(new THREE.Vector3()) : this.root.position.clone().setY(this.root.position.y + 3);
  }
  setLevel(lv: number) {
    if (lv === this.level) return;
    this.level = lv;
    if (this.model) this.root.remove(this.model);
    this.model = buildBulwarkModel(this.type, Math.min(3, Math.max(1, lv)) as 1 | 2 | 3, this.team);
    this.root.add(this.model);
    this.bar.position.y = this.type === 'arrow' ? 3.6 + lv * 0.5 : this.type === 'frost' ? 3.2 + lv * 0.3 : this.type === 'fire' ? 3 : 2.6 + lv * 0.3;
  }
  aim(simFacing: number) { this.targetYaw = simFacing + Math.PI / 2; }
  place(x: number, y: number, ground: number, hpFrac: number, cam: THREE.Camera, dt: number) {
    this.t += dt;
    if (this.sinking < 0) this.root.position.copy(toWorld(x, y, ground));
    this.fill.scale.x = Math.max(0.001, hpFrac);
    const d = cam.position.distanceTo(this.root.position);
    this.root.visible = d < 120;
    this.bar.visible = this.type !== 'spikes' && d < 45 && (hpFrac < 0.999 || d < 18);
    this.bar.quaternion.copy(cam.quaternion);
    this.bar.scale.setScalar(THREE.MathUtils.clamp(d / 16, 0.7, 2));
    const tr = this.turret;
    if (tr) { let dd = this.targetYaw - this.yaw; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); this.yaw += dd * Math.min(1, dt * 8); tr.rotation.y = this.yaw; }
    const glow = this.model?.userData.glow as THREE.Mesh | undefined;
    if (glow) { glow.rotation.y += dt * (this.type === 'frost' ? 0.8 : 0); const m = glow.material as THREE.MeshStandardMaterial; if (m.emissiveIntensity !== undefined) m.emissiveIntensity = (this.type === 'frost' ? 2 : 1.5) * (0.85 + 0.15 * Math.sin(this.t * 3)); }
  }
  /** Destruction: sink + tilt; returns false when finished. */
  collapse(dt: number): boolean {
    if (this.sinking < 0) this.sinking = 0;
    this.sinking += dt;
    this.root.position.y -= dt * 2.4;
    this.root.rotation.z = Math.min(0.5, this.sinking * 0.4);
    this.bar.visible = false;
    return this.sinking < 1.4;
  }
  /** Range (m) for indicators. */
  get range(): number { const l = BULWARKS[this.type].levels[Math.max(0, this.level - 1)]!; return l.range ?? l.aura ?? 1.2; }
}

/** Wolf mercenary view (enemy "send" unit). Same placement contract as UnitView. */
export class WolfView {
  readonly root = new THREE.Group();
  private wolf: { root: THREE.Group; update(speed: number, dt: number): void };
  private yaw = 0; private last = new THREE.Vector3(); private speed = 0;
  private dead = -1;
  private bar: THREE.Group; private fill: THREE.Mesh;
  constructor(readonly id: number, readonly team: 0 | 1, ally: boolean) {
    this.wolf = buildWolf(team);
    this.root.add(this.wolf.root);
    const hb = healthBar(0.7, ally, team); this.bar = hb.g; this.fill = hb.fill; this.bar.position.y = 1.35;
    this.root.add(this.bar);
  }
  place(x: number, y: number, ground: number, facing: number, hpFrac: number, cam: THREE.Camera, dt: number) {
    const p = toWorld(x, y, ground);
    if (dt > 0) this.speed += (Math.min(Math.hypot(p.x - this.last.x, p.z - this.last.z) / dt, 12) - this.speed) * Math.min(1, dt * 12);
    this.last.copy(p); this.root.position.copy(p);
    let d = facing + Math.PI / 2 - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 12);
    this.wolf.root.rotation.y = this.yaw;
    if (this.dead >= 0) { this.dead += dt; this.wolf.root.rotation.z = Math.min(1.5, this.dead * 4); this.bar.visible = false; return; }
    this.wolf.update(this.speed, dt);
    this.fill.scale.x = Math.max(0.001, hpFrac);
    const dist = cam.position.distanceTo(p);
    this.root.visible = dist < 110;
    this.bar.visible = dist < 40; this.bar.quaternion.copy(cam.quaternion);
  }
  setDead(v: boolean) { if (v && this.dead < 0) this.dead = 0; }
}

/** Hilde's Cairn Snare: three stacked stones, two stakes and a rope noose; a faint ring glows once armed. */
export class TrapView {
  readonly root = new THREE.Group();
  private ring: THREE.Mesh;
  private rope: THREE.Mesh;
  private t = 0;
  constructor(readonly id: number, readonly team: 0 | 1, ally: boolean, radius: number) {
    const stone = new THREE.MeshStandardMaterial({ color: 0x8c8a84, roughness: 1 });
    [[0.22, 0.12], [0.16, 0.3], [0.1, 0.43]].forEach(([r, y], i) => {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r!, 0).scale(1, 0.62, 1), stone);
      m.position.set(radius * 0.95 + (i % 2) * 0.04, y!, 0); m.rotation.y = i * 1.3; m.castShadow = true; this.root.add(m);
    });
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 1 });
    for (const a of [2.3, 4.0]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.45, 5).translate(0, 0.18, 0), wood);
      st.position.set(Math.cos(a) * radius * 0.9, 0, Math.sin(a) * radius * 0.9); st.rotation.z = 0.2; st.castShadow = true; this.root.add(st);
    }
    this.rope = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.75, 0.03, 5, 28).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb8a27a, roughness: 1 }));
    this.rope.position.y = 0.05; this.root.add(this.rope);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.92, radius, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: ally ? teamColor(team) : PALETTE.hostile, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.ring.position.y = 0.08; this.root.add(this.ring);
  }
  place(x: number, y: number, ground: number, armed: boolean, dt: number) {
    this.root.position.copy(toWorld(x, y, ground));
    this.t += dt;
    const mat = this.ring.material as THREE.MeshBasicMaterial;
    mat.opacity = armed ? 0.28 + Math.sin(this.t * 2.5) * 0.12 : Math.min(0.6, this.t * 1.2);
    this.rope.scale.setScalar(armed ? 1 : 0.6 + Math.min(0.4, this.t * 0.8));
  }
}
