import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadModel } from '../assets.js';
import { Mats } from './materials.js';
import { PALETTE, teamColor, teamBanner } from './palette.js';

/**
 * Articulated warrior rig (procedural stand-in until skinned hero models arrive — Art Bible §7).
 * Real PBR materials + CC0 photoscanned weapons; hierarchy mirrors a humanoid skeleton so swapping
 * to a skinned glTF later keeps the same animation driver interface (setLocomotion).
 */
let weapons: { sword: GLTF; shield: GLTF; hammer: GLTF } | null = null;
export async function preloadCharacterAssets() {
  const [sword, shield, hammer] = await Promise.all(['antique_estoc', 'kite_shield', 'ornate_war_hammer'].map(loadModel));
  weapons = { sword: sword!, shield: shield!, hammer: hammer! };
}
const cloneModel = (g: GLTF) => { const o = g.scene.clone(true); o.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.castShadow = true; }); return o; };

interface Limb { root: THREE.Bone; lower: THREE.Bone; end: THREE.Bone }

/** Rigid part waiting to be baked into the skinned mesh (geometry is in its bone's local space). */
class Part extends THREE.Object3D {
  constructor(readonly geo: THREE.BufferGeometry, readonly mat: THREE.Material) { super(); }
}
function part(geo: THREE.BufferGeometry, mat: THREE.Material, y = 0): Part { const p = new Part(geo, mat); p.position.y = y; return p; }

export interface CharacterOpts { team: 0 | 1; role: 'hero' | 'minion'; heroId?: string; scale?: number }

export type ActionAnim = 'attack' | 'shoot' | 'cast' | 'slam';

export class Character {
  readonly root = new THREE.Group();
  private hips = new THREE.Bone();
  private spine = new THREE.Bone();
  private head = new THREE.Bone();
  private armL: Limb; private armR: Limb; private legL: Limb; private legR: Limb;
  private skinned: THREE.SkinnedMesh[] = [];
  private capeTime = { value: 0 }; private capeSpeed = { value: 0 };
  private phase = Math.random() * 6;
  private breathe = Math.random() * 6;
  private speedSm = 0;
  private act: { kind: ActionAnim; t: number; dur: number } | null = null;
  private flinch = 0;
  private stunned = false;
  private deadT = -1; // >= 0 while dead (seconds since death)
  private crystal: THREE.Mesh | null = null;

  constructor(readonly opts: CharacterOpts) {
    const { team, role } = opts;
    const steel = Mats.steel(), dark = Mats.darkSteel(), leather = Mats.leather();
    const cloth = Mats.cloth(team, role === 'hero' ? teamBanner(team) : (team === 0 ? 0x6b4a32 : 0x3e4f5c));
    this.root.add(this.hips);
    this.root.rotation.order = 'YXZ'; // death topple is relative to facing
    this.hips.position.y = 0.98;

    const mage = opts.heroId === 'sigrun';
    // Pelvis: mail skirt (warriors) or long wool robe (casters) + belt.
    if (mage) this.hips.add(part(new THREE.CylinderGeometry(0.2, 0.36, 0.95, 14, 1, true).translate(0, -0.42, 0), cloth));
    else this.hips.add(part(new THREE.CylinderGeometry(0.2, 0.27, 0.36, 12, 1, true).translate(0, -0.14, 0), dark));
    this.hips.add(part(new THREE.TorusGeometry(0.205, 0.035, 6, 16).rotateX(Math.PI / 2).translate(0, 0.04, 0), leather));

    // Torso.
    this.hips.add(this.spine);
    this.spine.position.y = 0.05;
    const chest = new THREE.LatheGeometry([[0.17, 0], [0.2, 0.14], [0.235, 0.32], [0.225, 0.46], [0.13, 0.55]].map(([x, y]) => new THREE.Vector2(x!, y!)), 14);
    const chestMesh = part(chest, role === 'hero' && !mage ? steel : leather);
    chestMesh.scale.set(1, 1, 0.78);
    this.spine.add(chestMesh);
    // Tabard front/back in clan colours.
    for (const z of [0.18, -0.18]) {
      const tab = part(new THREE.PlaneGeometry(0.3, 0.8).translate(0, -0.05, 0), cloth);
      tab.position.set(0, 0.12, z); if (z < 0) tab.rotation.y = Math.PI;
      this.spine.add(tab);
    }
    // Fur mantle.
    this.spine.add(part(new THREE.TorusGeometry(0.17, 0.075, 8, 18).rotateX(Math.PI / 2).translate(0, 0.52, 0), Mats.fur()));

    // Head + helm.
    this.spine.add(this.head);
    this.head.position.y = 0.62;
    if (mage) {
      // Fur hood with a shadowed face opening — the caster silhouette.
      this.head.add(part(new THREE.SphereGeometry(0.15, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1, 1.25, 1.1).translate(0, 0.08, -0.01), Mats.fur()));
      this.head.add(part(new THREE.ConeGeometry(0.13, 0.22, 12, 1, true).rotateX(Math.PI).translate(0, 0.0, 0), Mats.fur()));
      this.head.add(part(new THREE.SphereGeometry(0.1, 12, 8).scale(1, 1.1, 0.6).translate(0, 0.08, 0.07), shadowMat()));
    } else {
      const helm = part(new THREE.SphereGeometry(0.125, 16, 12).scale(1, 1.18, 1.05).translate(0, 0.1, 0), steel);
      this.head.add(helm);
      this.head.add(part(new THREE.BoxGeometry(0.17, 0.025, 0.04).translate(0, 0.1, 0.12), shadowMat()));
      this.head.add(part(new THREE.BoxGeometry(0.03, 0.12, 0.03).translate(0, 0.05, 0.135), steel)); // nasal guard
    }
    if (role === 'hero' && !mage) this.addAntlers(dark);
    else if (role !== 'hero') this.head.add(part(new THREE.TorusGeometry(0.15, 0.02, 6, 16).rotateX(Math.PI / 2).translate(0, 0.12, 0), dark)); // kettle-helm brim

    // Arms (shoulder pivots on the spine).
    this.armL = this.limb(-1, steel, leather, true);
    this.armR = this.limb(1, steel, leather, true);
    // Legs (hip pivots).
    this.legL = this.limb(-1, steel, leather, false);
    this.legR = this.limb(1, steel, leather, false);

    // Equipment.
    if (mage) {
      // Rune staff topped with a glowing ice crystal (signature shape, Art Bible §7).
      const staff = new THREE.Group();
      staff.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 1.75, 7).translate(0, 0.35, 0), Mats.timber()));
      const prongs = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 5, 10, Math.PI * 1.4).rotateZ(-Math.PI * 0.2).translate(0, 1.27, 0), Mats.darkSteel());
      this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0).scale(1, 1.8, 1).translate(0, 1.3, 0),
        new THREE.MeshStandardMaterial({ color: 0x9fdcff, emissive: 0x4fb4ff, emissiveIntensity: 2.6, roughness: 0.15, metalness: 0.1 }));
      staff.add(prongs, this.crystal);
      staff.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      staff.rotation.set(Math.PI / 2, 0, 0); staff.position.set(0, -0.02, 0.02);
      this.armR.end.add(staff);
    } else if (weapons) {
      if (role === 'hero') {
        const sword = cloneModel(weapons.sword);
        sword.scale.setScalar(0.8); sword.rotation.set(Math.PI / 2, 0, 0); sword.position.set(0, -0.02, 0.02);
        this.armR.end.add(sword);
        const shield = cloneModel(weapons.shield);
        shield.scale.setScalar(0.62); shield.rotation.set(0, -Math.PI / 2, 0); shield.position.set(-0.07, 0.05, 0);
        this.armL.lower.add(shield);
      } else {
        const hammer = cloneModel(weapons.hammer);
        hammer.scale.setScalar(1.3); hammer.rotation.set(Math.PI / 2, 0, 0); hammer.position.set(0, -0.02, 0.0);
        this.armR.end.add(hammer);
      }
    }
    if (role === 'hero') this.addCape(cloth);

    this.bake();
    const s = opts.scale ?? (role === 'hero' ? 1.04 : 0.9);
    this.root.scale.setScalar(s);
  }

  /**
   * Bake every rigid Part into one SkinnedMesh per material (each vertex weighted 100% to its bone).
   * ~40 meshes -> ~7 draw calls per character, and the same skeleton/driver works for real skinned models later.
   */
  private bake() {
    this.root.updateMatrixWorld(true);
    const bones: THREE.Bone[] = [];
    this.hips.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const parts: Part[] = [];
    this.hips.traverse((o) => { if (o instanceof Part) parts.push(o); });
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    for (const p of parts) {
      const bi = bones.indexOf(p.parent as THREE.Bone);
      const g = p.geo.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, p.matrixWorld));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      const n = g.attributes.position!.count;
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).map((_, i) => (i % 4 === 0 ? bi : 0)), 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
      const list = byMat.get(p.mat) ?? []; list.push(g.index ? g : g); byMat.set(p.mat, list);
      p.removeFromParent();
    }
    const skeleton = new THREE.Skeleton(bones);
    for (const [mat, geos] of byMat) {
      const mesh = new THREE.SkinnedMesh(mergeGeometries(geos)!, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.frustumCulled = false; // bounds follow the animated skeleton; units are culled by distance instead
      this.skinned.push(mesh);
      this.root.add(mesh);
    }
    this.skinned[0]!.add(this.hips);
    for (const m of this.skinned) m.bind(skeleton, new THREE.Matrix4());
  }

  private limb(side: -1 | 1, steel: THREE.Material, leather: THREE.Material, arm: boolean): Limb {
    const root = new THREE.Bone(), lower = new THREE.Bone(), end = new THREE.Bone();
    if (arm) {
      root.position.set(side * 0.27, 0.47, 0);
      this.spine.add(root);
      root.add(part(new THREE.SphereGeometry(0.105, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 0.02, 0), steel)); // pauldron
      root.add(part(new THREE.CylinderGeometry(0.05, 0.045, 0.29, 8).translate(0, -0.15, 0), leather));
      lower.position.y = -0.3; root.add(lower);
      lower.add(part(new THREE.CylinderGeometry(0.058, 0.045, 0.26, 8).translate(0, -0.13, 0), steel)); // vambrace
      end.position.y = -0.29; lower.add(end);
      end.add(part(new THREE.BoxGeometry(0.07, 0.09, 0.09), steel)); // gauntlet
      root.rotation.z = side * 0.12;
    } else {
      root.position.set(side * 0.11, -0.04, 0);
      this.hips.add(root);
      root.add(part(new THREE.CylinderGeometry(0.08, 0.06, 0.45, 8).translate(0, -0.225, 0), leather));
      lower.position.y = -0.46; root.add(lower);
      lower.add(part(new THREE.SphereGeometry(0.065, 8, 6), steel)); // knee cop
      lower.add(part(new THREE.CylinderGeometry(0.06, 0.05, 0.42, 8).translate(0, -0.22, 0), steel)); // greave
      end.position.y = -0.46; lower.add(end);
      end.add(part(new THREE.BoxGeometry(0.11, 0.09, 0.26).translate(0, 0.0, 0.05), leather)); // boot
    }
    return { root, lower, end };
  }

  /** Hero silhouette signature: antlered helm (Art Bible §7 — readable at 30 m). */
  private addAntlers(mat: THREE.Material) {
    for (const side of [-1, 1]) {
      const beam = new THREE.Bone(); beam.position.set(side * 0.09, 0.2, 0); beam.rotation.z = -side * 0.7; this.head.add(beam);
      beam.add(part(new THREE.CylinderGeometry(0.012, 0.024, 0.32, 6).translate(0, 0.16, 0), mat));
      for (let t = 0; t < 3; t++) {
        const tine = part(new THREE.CylinderGeometry(0.006, 0.014, 0.14 - t * 0.02, 5).translate(0, 0.07, 0), mat);
        tine.position.y = 0.1 + t * 0.09; tine.rotation.z = side * (0.9 - t * 0.2); tine.rotation.x = -0.3;
        beam.add(tine);
      }
    }
  }

  private addCape(cloth: THREE.Material) {
    const geo = new THREE.PlaneGeometry(0.5, 1.15, 6, 12).translate(0, -0.575, 0);
    const mat = (cloth as THREE.MeshStandardMaterial).clone();
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uT = this.capeTime; sh.uniforms.uS = this.capeSpeed;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uT; uniform float uS;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
float k = clamp(-position.y / 1.15, 0.0, 1.0);
transformed.z -= k * k * (0.15 + uS * 0.55) + sin(uT * 3.0 + position.y * 5.0 + position.x * 3.0) * 0.035 * k;
transformed.y += k * k * uS * 0.25;`);
    };
    mat.customProgramCacheKey = () => 'cape';
    const cape = part(geo, mat);
    cape.position.set(0, 0.52, -0.17);
    this.spine.add(cape);
  }

  /** Trigger an upper-body action animation (attack swing, ranged shot, spell cast, ground slam). */
  play(kind: ActionAnim, dur = 0.55) { if (this.deadT < 0) this.act = { kind, t: 0, dur }; }
  hit() { this.flinch = 1; }
  setStunned(v: boolean) { this.stunned = v; }
  setDead(dead: boolean) {
    if (dead && this.deadT < 0) { this.deadT = 0; this.act = null; }
    if (!dead) this.deadT = -1;
  }
  get isDead() { return this.deadT >= 0; }

  /** Drive procedural locomotion from actual ground speed (m/s), then layer actions/reactions on top. */
  update(speed: number, dt: number) {
    if (this.deadT >= 0) { this.updateDeath(dt); return; }
    this.root.rotation.x = 0; this.root.position.y = 0;
    this.speedSm += (speed - this.speedSm) * Math.min(1, dt * 10);
    const k = Math.min(1, this.speedSm / 5.6);
    this.phase += dt * (this.speedSm / 1.7) * Math.PI; // ~1.7 m per stride
    this.breathe += dt * 1.6;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    // Legs: hip swing + knee flexion on the recovery phase.
    this.legL.root.rotation.x = -s * 0.62 * k;
    this.legR.root.rotation.x = s * 0.62 * k;
    this.legL.lower.rotation.x = Math.max(0, c) * 1.05 * k + 0.04;
    this.legR.lower.rotation.x = Math.max(0, -c) * 1.05 * k + 0.04;
    this.legL.end.rotation.x = -this.legL.lower.rotation.x * 0.4;
    this.legR.end.rotation.x = -this.legR.lower.rotation.x * 0.4;
    // Arms counter-swing; shield arm stays guarded.
    this.armR.root.rotation.x = s * 0.5 * k + 0.05;
    this.armR.lower.rotation.x = -0.35 - k * 0.35;
    this.armL.root.rotation.x = -s * 0.2 * k - 0.15;
    this.armL.lower.rotation.x = -0.9;
    // Body: bob, lean, twist; breathing when idle.
    this.hips.position.y = 0.98 - k * 0.05 + Math.abs(c) * 0.055 * k + Math.sin(this.breathe) * 0.006 * (1 - k);
    this.spine.rotation.x = 0.16 * k + Math.sin(this.breathe) * 0.015 * (1 - k);
    this.spine.rotation.y = s * 0.12 * k;
    this.hips.rotation.y = -s * 0.08 * k;
    this.head.rotation.x = -0.1 * k;
    this.capeTime.value += dt; this.capeSpeed.value = k;
    if (this.crystal) this.crystal.rotation.y += dt * 1.5;

    // Hit flinch.
    if (this.flinch > 0) { this.spine.rotation.x -= this.flinch * 0.28; this.head.rotation.x -= this.flinch * 0.2; this.flinch = Math.max(0, this.flinch - dt * 6); }
    // Stun: slumped, swaying.
    if (this.stunned) { this.spine.rotation.x = 0.35; this.head.rotation.x = 0.4; this.spine.rotation.z = Math.sin(this.breathe * 4) * 0.08; }
    else this.spine.rotation.z = 0;
    // Action overlay.
    const a = this.act;
    if (a) {
      a.t += dt;
      const p = Math.min(1, a.t / a.dur);
      const ease = (x: number) => x * x * (3 - 2 * x);
      if (a.kind === 'attack') {
        // Wind up high and back, strike down across the body, recover.
        const up = p < 0.45 ? ease(p / 0.45) : 1 - ease(Math.min(1, (p - 0.45) / 0.2));
        const strike = p < 0.45 ? 0 : p < 0.65 ? ease((p - 0.45) / 0.2) : 1 - ease((p - 0.65) / 0.35);
        this.armR.root.rotation.x = -2.6 * up + 0.9 * strike;
        this.armR.root.rotation.z = 0.5 * up - 0.35 * strike;
        this.armR.lower.rotation.x = -0.9 * up - 0.2 * strike;
        this.spine.rotation.y = 0.45 * up - 0.6 * strike;
        this.spine.rotation.x += 0.15 * strike;
        this.armL.root.rotation.x = -0.6; this.armL.lower.rotation.x = -1.1; // shield up
      } else if (a.kind === 'shoot' || a.kind === 'cast') {
        const raise = p < 0.35 ? ease(p / 0.35) : 1 - ease((p - 0.35) / 0.65);
        this.armR.root.rotation.x = -1.6 * raise; this.armR.lower.rotation.x = -0.3 * raise;
        if (a.kind === 'cast') { this.armL.root.rotation.x = -1.4 * raise; this.armL.lower.rotation.x = -0.2 * raise; this.armL.root.rotation.z = -0.3 * raise; }
        this.spine.rotation.y = -0.25 * raise;
      } else if (a.kind === 'slam') {
        const up = p < 0.5 ? ease(p / 0.5) : 1 - ease((p - 0.5) / 0.5);
        this.armR.root.rotation.x = -2.9 * up; this.armL.root.rotation.x = -2.9 * up;
        this.spine.rotation.x = -0.25 * up + (p > 0.5 ? 0.3 * (1 - p) : 0);
      }
      if (p >= 1) this.act = null;
    }
  }

  private updateDeath(dt: number) {
    this.deadT += dt;
    const p = Math.min(1, this.deadT / 0.7);
    const e = 1 - (1 - p) * (1 - p);
    this.root.rotation.x = -e * 1.45;           // topple backwards
    this.root.position.y = -Math.max(0, this.deadT - 2.5) * 0.25; // sink into the ground after a while
    this.legL.lower.rotation.x = 0.4 * e; this.legR.lower.rotation.x = 0.2 * e;
    this.armL.root.rotation.z = -0.8 * e; this.armR.root.rotation.z = 0.8 * e;
  }

  setFirstPerson(fp: boolean) { this.root.visible = !fp; }
  setVisible(v: boolean) { this.root.visible = v; }
}

let shadow: THREE.MeshStandardMaterial | null = null;
function shadowMat() { return (shadow ??= new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 })); }

export const TEAM_RIM = { 0: PALETTE.dawn, 1: PALETTE.dusk } as const;
export { teamColor };
