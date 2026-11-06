import * as THREE from 'three';
import type { CameraRig } from '../render/camera.js';

export interface InputEvents { onMoveOrder(p: THREE.Vector3): void; onStop(): void }

/**
 * Unified pointer input (mouse + touch + pen) so desktop and mobile share one path.
 *  Desktop: right/left click = move (hold to steer), wheel = zoom, arrows / screen edge = pan, Space = recenter, Y = lock, S = stop.
 *  Touch:   tap = move, one-finger drag = pan, pinch = zoom, double-tap own area = recenter (via HUD button).
 */
export class Input {
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ndc = new THREE.Vector2();
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; type: string; dragged: boolean }>();
  private pinchDist = 0;
  private holdMove: number | null = null;
  private holdTimer = 0;
  private mouse = { x: -1, y: -1, inside: false };
  private keys = new Set<string>();

  constructor(private el: HTMLElement, private rig: CameraRig, private ev: InputEvents) {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('pointerleave', () => { this.mouse.inside = false; });
    el.addEventListener('wheel', (e) => { e.preventDefault(); rig.zoom(Math.sign(e.deltaY) * 3); }, { passive: false });
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') { rig.locked = true; e.preventDefault(); }
      if (e.code === 'KeyY') rig.locked = !rig.locked;
      if (e.code === 'KeyS') ev.onStop();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.holdMove = null; });
  }

  groundAt(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.el.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.rig.camera);
    return this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
  }

  private order(x: number, y: number) { const p = this.groundAt(x, y); if (p) this.ev.onMoveOrder(p); }

  private down = (e: PointerEvent) => {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, type: e.pointerType, dragged: false });
    if (e.pointerType === 'mouse') {
      if (e.button === 0 || e.button === 2) { this.order(e.clientX, e.clientY); this.holdMove = e.pointerId; this.holdTimer = 0.15; }
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
  };

  private move = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') this.mouse = { x: e.clientX, y: e.clientY, inside: true };
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (p.type === 'mouse') return;
    if (this.pointers.size === 1) {
      if (!p.dragged && Math.hypot(p.x - p.sx, p.y - p.sy) > 14) p.dragged = true;
      if (p.dragged) {
        const k = this.rig.distance / this.el.clientHeight * 1.1;
        this.rig.pan(-dx * k, -dy * k);
      }
    } else if (this.pointers.size === 2) {
      p.dragged = true;
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      this.rig.zoom((this.pinchDist - d) * 0.08);
      this.pinchDist = d;
    }
  };

  private up = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.holdMove === e.pointerId) this.holdMove = null;
    if (p && p.type !== 'mouse' && !p.dragged && this.pointers.size === 0) this.order(e.clientX, e.clientY);
    if (p && this.pointers.size === 1) for (const q of this.pointers.values()) q.dragged = true; // end of pinch: don't tap
  };

  update(dt: number) {
    // Hold-to-steer (MOBA convention), throttled to protect the server's command budget.
    if (this.holdMove !== null) {
      this.holdTimer -= dt;
      const p = this.pointers.get(this.holdMove);
      if (p && this.holdTimer <= 0) { this.holdTimer = 0.15; this.order(p.x, p.y); }
    }
    const speed = this.rig.distance * 1.4 * dt;
    let px = 0, pz = 0;
    if (this.keys.has('ArrowLeft')) px -= 1; if (this.keys.has('ArrowRight')) px += 1;
    if (this.keys.has('ArrowUp')) pz -= 1; if (this.keys.has('ArrowDown')) pz += 1;
    const m = this.mouse, edge = 14, W = this.el.clientWidth, H = this.el.clientHeight;
    if (m.inside && this.pointers.size === 0 && matchMedia('(pointer: fine)').matches) {
      if (m.x < edge) px -= 1; if (m.x > W - edge) px += 1;
      if (m.y < edge) pz -= 1; if (m.y > H - edge) pz += 1;
    }
    if (px || pz) this.rig.pan(px * speed, pz * speed);
  }
}
