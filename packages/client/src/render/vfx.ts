import * as THREE from 'three';
import { makeFire } from './fire.js';

/**
 * Gameplay VFX (Art Bible §10): one pooled CPU particle system + short-lived meshes.
 * Telegraph decals conform to the terrain; team colour only where it carries meaning, hostile magenta for threats.
 */
type Ground = (wx: number, wz: number) => number;

const MAX_P = 1400;
let softTex: THREE.Texture | null = null;
function soft(): THREE.Texture {
  if (softTex) return softTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  softTex = new THREE.CanvasTexture(c);
  return softTex;
}

interface Transient { obj: THREE.Object3D; t: number; dur: number; update(p: number, dt: number): void; dispose?(): void }

export class Vfx {
  readonly group = new THREE.Group();
  // Particle pool (additive glow) — positions/colors/sizes updated on the CPU.
  private pPos = new Float32Array(MAX_P * 3); private pCol = new Float32Array(MAX_P * 3); private pSize = new Float32Array(MAX_P);
  private pVel = new Float32Array(MAX_P * 3); private pLife = new Float32Array(MAX_P); private pMax = new Float32Array(MAX_P);
  private pBase = new Float32Array(MAX_P * 3); private pGrav = new Float32Array(MAX_P); private pStart = new Float32Array(MAX_P);
  private pCursor = 0;
  private points: THREE.Points;
  private items: Transient[] = [];
  private lights: { l: THREE.PointLight; t: number; dur: number; i0: number }[] = [];

  constructor(private ground: Ground, maxLights = 2) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: soft() }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC;
        uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC;
        void main(){ float a = texture2D(map, gl_PointCoord).a; if (a < 0.02) discard; gl_FragColor = vec4(vC * a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.group.add(this.points);
    for (let i = 0; i < maxLights; i++) { const l = new THREE.PointLight(0xffffff, 0, 14, 2); this.group.add(l); this.lights.push({ l, t: 1, dur: 1, i0: 0 }); }
  }

  setViewportHeight(h: number) { (this.points.material as THREE.ShaderMaterial).uniforms.scale!.value = h * 0.9; }

  // ---- particles ----------------------------------------------------------------------------
  emit(p: THREE.Vector3, count: number, o: { color: number; speed?: number; up?: number; life?: number; size?: number; gravity?: number; spread?: number; dir?: THREE.Vector3 }) {
    const c = new THREE.Color(o.color);
    for (let n = 0; n < count; n++) {
      const i = this.pCursor; this.pCursor = (this.pCursor + 1) % MAX_P;
      const sp = (o.speed ?? 3) * (0.4 + Math.random() * 0.8), s = o.spread ?? 0.2;
      let vx = (Math.random() * 2 - 1), vy = Math.random() * (o.up ?? 1), vz = (Math.random() * 2 - 1);
      if (o.dir) { vx = o.dir.x + vx * 0.35; vy = o.dir.y + vy * 0.35; vz = o.dir.z + vz * 0.35; }
      const l = Math.hypot(vx, vy, vz) || 1;
      this.pVel.set([vx / l * sp, vy / l * sp, vz / l * sp], i * 3);
      this.pPos.set([p.x + (Math.random() - 0.5) * s, p.y + (Math.random() - 0.5) * s, p.z + (Math.random() - 0.5) * s], i * 3);
      const k = 0.75 + Math.random() * 0.35;
      this.pBase.set([c.r * k, c.g * k, c.b * k], i * 3);
      this.pLife[i] = this.pMax[i] = (o.life ?? 0.6) * (0.6 + Math.random() * 0.6);
      this.pStart[i] = (o.size ?? 0.25) * (0.7 + Math.random() * 0.6);
      this.pGrav[i] = o.gravity ?? 4;
    }
  }

  // ---- effects ------------------------------------------------------------------------------
  slash(origin: THREE.Vector3, yaw: number, color: number, radius = 2.4) {
    const geo = new THREE.RingGeometry(radius * 0.45, radius, 28, 1, -1.1, 2.2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, map: arcTex() });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(origin).add(new THREE.Vector3(0, 1.15, 0));
    m.rotation.set(-Math.PI / 2 + 0.35, 0, yaw); // lie flat, tilted like a diagonal cut, centred on facing
    this.add(m, 0.28, (p) => { mat.opacity = 0.85 * (1 - p); m.scale.setScalar(0.85 + p * 0.3); m.rotation.z = yaw + (p - 0.5) * 0.6; }, () => { geo.dispose(); mat.dispose(); });
  }

  impact(p: THREE.Vector3, color: number, big = false) {
    this.emit(p, big ? 26 : 12, { color, speed: big ? 6 : 4, up: 1.4, life: 0.45, size: big ? 0.35 : 0.22, gravity: 9 });
    this.emit(p, 1, { color: 0xffffff, speed: 0, life: 0.12, size: big ? 2.2 : 1.2, gravity: 0 });
  }

  /** Ground telegraph that fills over `dur` seconds (Art Bible §10: decals are the threat language). */
  telegraph(cx: number, cz: number, r: number, dur: number, color: number) {
    const geo = discOnGround(cx, cz, r, this.ground);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uP: { value: 0 }, uC: { value: new THREE.Color(color) } },
      vertexShader: 'varying vec2 vL; void main(){ vL = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uP; uniform vec3 uC; varying vec2 vL;
        void main(){ float d = length(vL); if (d > 1.0) discard;
          float ring = smoothstep(0.9, 0.97, d) * (1.0 - smoothstep(0.97, 1.0, d));
          float fill = step(d, uP) * 0.32 + smoothstep(uP - 0.06, uP, d) * step(d, uP) * 0.5;
          gl_FragColor = vec4(uC * 1.6, ring * 0.95 + fill * 0.6 + 0.08); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 4;
    this.add(m, Math.max(0.05, dur), (p) => { mat.uniforms.uP!.value = p; }, () => { geo.dispose(); mat.dispose(); });
  }

  /** Expanding shockwave + particles + light flash. kind: frost | horn | fire */
  blast(cx: number, cz: number, r: number, kind: 'frost' | 'horn' | 'fire') {
    const y = this.ground(cx, cz);
    const color = kind === 'frost' ? 0x9fe0ff : kind === 'fire' ? 0xffa040 : 0xe9d7a8;
    const geo = new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat); m.position.set(cx, y + 0.25, cz);
    this.add(m, 0.5, (p) => { m.scale.setScalar(0.2 + p * r); mat.opacity = 0.9 * (1 - p); }, () => { geo.dispose(); mat.dispose(); });
    const c = new THREE.Vector3(cx, y + 0.4, cz);
    if (kind === 'frost') {
      for (let k = 0; k < 10; k++) this.shard(c, r);
      this.emit(c, 60, { color: 0xbfeaff, speed: r * 1.6, up: 0.8, life: 0.8, size: 0.3, gravity: 3, spread: r * 0.6 });
    } else {
      this.emit(c, 50, { color, speed: r * 1.8, up: 0.25, life: 0.7, size: 0.45, gravity: 1, spread: 0.6 });
    }
    this.flash(c, color, kind === 'frost' ? 40 : 25, 0.35);
  }

  private shard(c: THREE.Vector3, r: number) {
    const geo = new THREE.OctahedronGeometry(0.25, 0).scale(0.5, 2.2, 0.5);
    const mat = new THREE.MeshStandardMaterial({ color: 0xcdefff, emissive: 0x5fbfff, emissiveIntensity: 1.2, roughness: 0.1, transparent: true });
    const m = new THREE.Mesh(geo, mat);
    const a = Math.random() * Math.PI * 2, d = Math.random() * r * 0.8;
    const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
    m.position.set(x, this.ground(x, z), z);
    m.rotation.set((Math.random() - 0.5) * 0.8, Math.random() * 6, (Math.random() - 0.5) * 0.8);
    this.add(m, 1.4, (p) => { const g = p < 0.15 ? p / 0.15 : 1; m.scale.setScalar(g * (0.8 + Math.random() * 0.02)); mat.opacity = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1; }, () => { geo.dispose(); mat.dispose(); });
  }

  flash(p: THREE.Vector3, color: number, intensity: number, dur: number) {
    const slot = this.lights.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    slot.l.position.copy(p); slot.l.color.setHex(color); slot.t = 0; slot.dur = dur; slot.i0 = intensity;
  }

  levelUp(p: THREE.Vector3) {
    for (let k = 0; k < 40; k++) this.emit(new THREE.Vector3(p.x + Math.cos(k) * 0.8, p.y + Math.random() * 0.3, p.z + Math.sin(k) * 0.8), 1, { color: 0xffd27a, speed: 2.2, up: 6, life: 1.1, size: 0.18, gravity: -1.5, dir: new THREE.Vector3(0, 1, 0) });
    this.flash(p.clone().setY(p.y + 1.5), 0xffd27a, 20, 0.6);
  }

  dust(p: THREE.Vector3, amount = 24, color = 0x8a8478) {
    this.emit(p, amount, { color, speed: 2.2, up: 0.6, life: 1.1, size: 0.6, gravity: -0.3, spread: 0.8 });
  }

  // ---- loop ---------------------------------------------------------------------------------
  private add(obj: THREE.Object3D, dur: number, update: (p: number, dt: number) => void, dispose?: () => void) {
    this.group.add(obj);
    this.items.push({ obj, t: 0, dur, update, dispose });
  }

  update(dt: number) {
    for (let i = 0; i < MAX_P; i++) {
      if (this.pLife[i]! <= 0) { if (this.pSize[i]! !== 0) this.pSize[i] = 0; continue; }
      const life = (this.pLife[i]! -= dt);
      const k = Math.max(0, life / this.pMax[i]!);
      this.pVel[i * 3 + 1]! -= this.pGrav[i]! * dt;
      const drag = 1 - Math.min(1, dt * 1.8);
      for (let a = 0; a < 3; a++) { this.pVel[i * 3 + a]! *= drag; this.pPos[i * 3 + a]! += this.pVel[i * 3 + a]! * dt; this.pCol[i * 3 + a] = this.pBase[i * 3 + a]! * k; }
      this.pSize[i] = this.pStart[i]! * (0.6 + 0.4 * k);
    }
    const g = this.points.geometry;
    g.attributes.position!.needsUpdate = true; g.attributes.color!.needsUpdate = true; g.attributes.size!.needsUpdate = true;
    for (const it of [...this.items]) {
      it.t += dt;
      const p = Math.min(1, it.t / it.dur);
      it.update(p, dt);
      if (p >= 1) { this.group.remove(it.obj); it.dispose?.(); this.items.splice(this.items.indexOf(it), 1); }
    }
    for (const s of this.lights) { s.t += dt; s.l.intensity = s.t < s.dur ? s.i0 * (1 - s.t / s.dur) : 0; }
  }
}

/** Disc mesh whose vertices follow the terrain, UVs in [0,1] for radial shading. */
function discOnGround(cx: number, cz: number, r: number, ground: Ground): THREE.BufferGeometry {
  const seg = 40, rings = 6;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  pos.push(cx, ground(cx, cz) + 0.12, cz); uv.push(0.5, 0.5);
  for (let k = 1; k <= rings; k++) for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2, rr = (k / rings) * r;
    const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
    pos.push(x, ground(x, z) + 0.12, z); uv.push(0.5 + Math.cos(a) * 0.5 * (k / rings), 0.5 + Math.sin(a) * 0.5 * (k / rings));
  }
  for (let i = 0; i < seg; i++) idx.push(0, 1 + i, 1 + ((i + 1) % seg));
  for (let k = 1; k < rings; k++) for (let i = 0; i < seg; i++) {
    const a = 1 + (k - 1) * seg + i, b = 1 + (k - 1) * seg + ((i + 1) % seg), c = a + seg, d = b + seg;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

let arc: THREE.Texture | null = null;
function arcTex(): THREE.Texture {
  if (arc) return arc;
  const c = document.createElement('canvas'); c.width = 128; c.height = 16;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 128, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0.2)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 16);
  arc = new THREE.CanvasTexture(c);
  return arc;
}

// ---- Projectile visuals ------------------------------------------------------------------------
export class ProjectileView {
  readonly root = new THREE.Group();
  private emitT = 0;
  constructor(readonly fx: string, private vfx: Vfx) {
    if (fx === 'ice_lance') {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0).scale(3.2, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xd8f4ff, emissive: 0x58c8ff, emissiveIntensity: 2.4, roughness: 0.1 }));
      this.root.add(m);
    } else if (fx === 'tower_bolt') {
      const f = makeFire(0.45); f.position.y = -0.35; this.root.add(f);
    } else {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), new THREE.MeshBasicMaterial({ color: 0xbfeaff }));
      this.root.add(m);
    }
  }
  place(p: THREE.Vector3, facing: number, dt: number) {
    this.root.position.copy(p);
    this.root.rotation.y = facing;
    this.emitT -= dt;
    if (this.emitT <= 0) {
      this.emitT = 0.016;
      const col = this.fx === 'tower_bolt' ? 0xff9a3a : 0x9fdcff;
      this.vfx.emit(p, this.fx === 'ice_lance' ? 3 : 2, { color: col, speed: 0.5, up: 0.5, life: 0.35, size: this.fx === 'tower_bolt' ? 0.35 : 0.25, gravity: this.fx === 'tower_bolt' ? -2 : 0.5 });
    }
  }
}
