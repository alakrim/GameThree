import * as THREE from 'three';

/**
 * Over-the-shoulder third-person camera with first-person zoom (Art Bible §3):
 * yaw/pitch orbit around a head-height pivot, right-shoulder offset, terrain collision.
 */
export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0; pitch = -0.18;
  boom = 4.2; private boomSm = 4.2;
  readonly minBoom = 0; readonly maxBoom = 8;
  private pivot = new THREE.Vector3();
  private pivotSm = new THREE.Vector3();
  private first = true;
  private lastThird = 4.2;
  /** Trauma-style shake (0..1): offset ∝ trauma², decays over ~0.6 s. */
  private trauma = 0; private shakeT = 0;
  /** Camera orientation without shake — aiming uses this so shake never moves the reticle's target. */
  readonly aimQuaternion = new THREE.Quaternion();

  constructor(private groundAt: (wx: number, wz: number) => number) {
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.08, 1400);
  }

  get firstPerson() { return this.boomSm < 0.6; }

  look(dx: number, dy: number) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.25, 0.95);
  }
  zoom(delta: number) { this.boom = THREE.MathUtils.clamp(this.boom + delta, this.minBoom, this.maxBoom); if (this.boom < 0.6) this.boom = delta < 0 ? 0 : 0.6; }
  shake(amount: number) { this.trauma = Math.min(1, this.trauma + amount); }
  toggleView() { if (this.boom < 0.6) this.boom = this.lastThird; else { this.lastThird = this.boom; this.boom = 0; } }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 82 : 70; // portrait phones need a wider vertical FOV
    this.camera.updateProjectionMatrix();
  }

  /** Movement basis in SIM space (x, y) for the current yaw. */
  basis(): { fwd: [number, number]; right: [number, number] } {
    return { fwd: [-Math.sin(this.yaw), Math.cos(this.yaw)], right: [Math.cos(this.yaw), Math.sin(this.yaw)] };
  }

  update(target: THREE.Vector3, dt: number) {
    this.pivot.set(target.x, target.y + 1.62, target.z);
    if (this.first) { this.pivotSm.copy(this.pivot); this.first = false; }
    // Tight follow on the horizontal plane; slightly softer vertically to absorb terrain bumps.
    this.pivotSm.x = this.pivot.x; this.pivotSm.z = this.pivot.z;
    this.pivotSm.y += (this.pivot.y - this.pivotSm.y) * Math.min(1, dt * 12);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    // Collision: shorten the boom if terrain intrudes between pivot and camera.
    let want = this.boom;
    const shoulder = 0.55 * Math.min(1, want / 4.2);
    for (let i = 1; i <= 8 && want > 0.3; i++) {
      const t = (i / 8) * want;
      const p = new THREE.Vector3(shoulder * (t / Math.max(want, 1e-3)), 0, t).applyQuaternion(q).add(this.pivotSm);
      if (p.y < this.groundAt(p.x, p.z) + 0.35) { want = Math.max(0.3, t - want / 8); break; }
    }
    this.boomSm += (want - this.boomSm) * Math.min(1, dt * (want < this.boomSm ? 20 : 6));
    const sh = 0.55 * Math.min(1, this.boomSm / 4.2);
    const off = new THREE.Vector3(sh, 0, this.boomSm).applyQuaternion(q);
    this.camera.position.copy(this.pivotSm).add(off);
    if (this.boomSm < 0.6) this.camera.position.y = this.pivotSm.y + 0.06; // eye height in first person
    this.camera.quaternion.copy(q);
    this.aimQuaternion.copy(q);
    if (this.trauma > 0) {
      this.shakeT += dt * 40;
      const k = this.trauma * this.trauma, n = (o: number) => Math.sin(this.shakeT * 1.3 + o) * 0.6 + Math.sin(this.shakeT * 2.9 + o * 2) * 0.4;
      this.camera.rotateZ(n(1) * 0.035 * k); this.camera.rotateX(n(2) * 0.025 * k); this.camera.rotateY(n(3) * 0.025 * k);
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }
  }
}
