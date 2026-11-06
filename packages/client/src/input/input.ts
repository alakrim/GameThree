import type { ThirdPersonCamera } from '../render/camera.js';

/**
 * Unified input. Desktop: WASD/arrows move relative to camera, mouse look (pointer lock), wheel zoom, V view toggle.
 * Touch: left half = floating virtual stick, right half = drag to look, VIEW button toggles first/third person.
 * Produces an analog movement vector in SIM space every frame.
 */
export class Input {
  private keys = new Set<string>();
  private stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private lookId = -1; private lookX = 0; private lookY = 0;
  locked = false;
  readonly touch = matchMedia('(pointer: coarse)').matches;
  private stickEl: HTMLDivElement; private knobEl: HTMLDivElement;

  /** Attack (slot 0) / abilities (1-3) press & release. */
  onAct?: (slot: number, phase: 'down' | 'up') => void;
  /** First user gesture (audio unlock). */
  onGesture?: () => void;

  constructor(private el: HTMLCanvasElement, private cam: ThirdPersonCamera) {
    const gesture = () => this.onGesture?.();
    addEventListener('pointerdown', gesture, { capture: true });
    addEventListener('keydown', gesture, { capture: true });
    document.addEventListener('mousedown', (e) => { if (this.locked && e.button === 0) this.onAct?.(0, 'down'); });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.onAct?.(0, 'up'); });
    const slotKeys: Record<string, number> = { KeyQ: 1, KeyE: 2, KeyR: 3, Digit1: 1, Digit2: 2, Digit3: 3 };
    const sens = 0.0022;
    el.addEventListener('click', () => { if (!this.touch && !this.locked) el.requestPointerLock?.(); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
    document.addEventListener('mousemove', (e) => { if (this.locked) cam.look(e.movementX * sens, e.movementY * sens); });
    el.addEventListener('wheel', (e) => { e.preventDefault(); cam.zoom(Math.sign(e.deltaY) * 0.8); }, { passive: false });
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyV') cam.toggleView();
      if (slotKeys[e.code] !== undefined) this.onAct?.(slotKeys[e.code]!, 'down');
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); if (slotKeys[e.code] !== undefined) this.onAct?.(slotKeys[e.code]!, 'up'); });
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    // Touch: virtual stick + look.
    this.stickEl = document.createElement('div'); this.stickEl.className = 'stick';
    this.knobEl = document.createElement('div'); this.knobEl.className = 'knob';
    this.stickEl.appendChild(this.knobEl); document.body.appendChild(this.stickEl);
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      el.setPointerCapture(e.pointerId);
      if (e.clientX < innerWidth * 0.45 && this.stick.id < 0) {
        this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
        this.stickEl.style.display = 'block'; this.stickEl.style.left = `${e.clientX}px`; this.stickEl.style.top = `${e.clientY}px`;
        this.knobEl.style.transform = 'translate(-50%, -50%)';
      } else if (this.lookId < 0) { this.lookId = e.pointerId; this.lookX = e.clientX; this.lookY = e.clientY; }
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stick.id) {
        const R = 56; let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
        const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
        this.stick.x = dx / R; this.stick.y = dy / R;
        this.knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (e.pointerId === this.lookId) {
        cam.look((e.clientX - this.lookX) * 0.0055, (e.clientY - this.lookY) * 0.0045);
        this.lookX = e.clientX; this.lookY = e.clientY;
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.stick.id) { this.stick.id = -1; this.stick.x = this.stick.y = 0; this.stickEl.style.display = 'none'; }
      if (e.pointerId === this.lookId) this.lookId = -1;
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }

  /** Analog movement in sim space, length <= 1. */
  movement(): [number, number] {
    let f = 0, r = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) r += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) r -= 1;
    if (this.stick.id >= 0) { f -= this.stick.y; r += this.stick.x; }
    const l = Math.hypot(f, r);
    if (l < 0.12) return [0, 0];
    if (l > 1) { f /= l; r /= l; }
    const { fwd, right } = this.cam.basis();
    return [fwd[0] * f + right[0] * r, fwd[1] * f + right[1] * r];
  }
}
