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
  // Status visuals (lazily built): shield bubble, root bindings, recall column.
  private bubble: THREE.Mesh | null = null;
  private roots: THREE.Group | null = null;
  private column: THREE.Mesh | null = null;
  private stT = 0;
  constructor(readonly id: number, readonly team: 0 | 1, readonly isHero: boolean, ally: boolean, readonly isLocal: boolean, readonly heroId?: string, unit?: string) {
    const scale = unit === 'troll' ? 2.3 : unit === 'brute' ? 1.4 : undefined;
    this.character = new Character({ team, role: isHero ? 'hero' : 'minion', heroId, scale });
    this.root.add(this.character.root);
    const w = isHero ? 1.0 : 0.6, h = isHero ? 0.09 : 0.06;
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.04, h + 0.04), new THREE.MeshBasicMaterial({ color: 0x0b0b0e, depthTest: false, transparent: true, opacity: 0.75 }));
    this.fill = new THREE.Mesh(new THREE.PlaneGeometry(w, h).translate(w / 2, 0, 0), new THREE.MeshBasicMaterial({ color: ally ? teamColor(team) : PALETTE.hostile, depthTest: false }));
    this.fill.position.set(-w / 2, 0, 0.001);
    bg.renderOrder = 20; this.fill.renderOrder = 21;
    this.bar.add(bg, this.fill);
    this.bar.position.y = isHero ? 2.45 : 1.95 * (scale ? scale / 0.9 : 1);
    if (scale) this.bar.scale.x = 1.6;
    this.bar.visible = !isLocal; // local player's health lives on the HUD
    this.root.add(this.bar);
  }

  /** Status bits from the snapshot (see protocol EntitySnapshot.st) → persistent body effects. */
  setStatus(st: number, dt: number) {
    this.stT += dt;
    const shielded = !!(st & 128), rooted = !!(st & 64), recalling = !!(st & 8192), dead = !!(st & 4);
    if (shielded && !dead) {
      this.bubble ??= this.makeBubble();
      this.bubble.visible = true;
      (this.bubble.material as THREE.ShaderMaterial).uniforms.uT!.value = this.stT;
    } else if (this.bubble) this.bubble.visible = false;
    if (rooted && !dead) {
      this.roots ??= this.makeRoots();
      this.roots.visible = true; this.roots.rotation.y += dt * 0.6;
    } else if (this.roots) this.roots.visible = false;
    if (recalling && !dead) {
      this.column ??= this.makeColumn();
      this.column.visible = true;
      const m = this.column.material as THREE.MeshBasicMaterial; m.opacity = 0.18 + Math.sin(this.stT * 6) * 0.05;
      this.column.rotation.y += dt;
    } else if (this.column) this.column.visible = false;
  }

  private makeBubble(): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(0xffd890) } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
        void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); vY = position.y;
          gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform float uT; uniform vec3 uC; varying vec3 vN; varying vec3 vV; varying float vY;
        void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.5); float band = 0.5 + 0.5 * sin(vY * 9.0 - uT * 4.0);
          gl_FragColor = vec4(uC * 1.6, f * (0.55 + 0.25 * band) + 0.04); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16).scale(0.75, 1.15, 0.75).translate(0, 1.05, 0), mat);
    m.renderOrder = 6; this.root.add(m); return m;
  }

  private makeRoots(): THREE.Group {
    // Rope bindings + frost at the ankles: unmistakable "can't move" read.
    const g = new THREE.Group();
    const rope = new THREE.MeshStandardMaterial({ color: 0xb8a27a, roughness: 1 });
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.32 - i * 0.04, 0.035, 5, 18).rotateX(Math.PI / 2 + (i - 1) * 0.2), rope);
      t.position.y = 0.12 + i * 0.13; g.add(t);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.7, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xd8c08a, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.position.y = 0.05; g.add(ring);
    this.root.add(g); return g;
  }

  private makeColumn(): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.95, 3.4, 20, 1, true).translate(0, 1.7, 0),
      new THREE.MeshBasicMaterial({ color: 0xffc870, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.root.add(m); return m;
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
    const dist = cam.position.distanceTo(p);
    this.root.visible = dist < 110; // beyond the fog: skip drawing entirely
    if (!this.isLocal) {
      this.bar.visible = dist < BAR_RANGE && !this.character.isDead;
      this.bar.quaternion.copy(cam.quaternion);
      const s = THREE.MathUtils.clamp(dist / 14, 0.6, 1.8); this.bar.scale.setScalar(s);
    }
  }
}
