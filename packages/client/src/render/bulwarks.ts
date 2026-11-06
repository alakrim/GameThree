import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Mats, boxUV } from './materials.js';
import { makeFire } from './fire.js';
import { teamColor, teamBanner } from './palette.js';

export type BulwarkType = 'arrow' | 'frost' | 'fire' | 'palisade' | 'spikes';

type V = readonly [number, number, number];
type Slot = 'timber' | 'darkSteel' | 'slate' | 'bark' | 'leather' | 'cloth' | 'paint' | 'rune';
type Kind = Slot | 'glowFrost' | 'glowEmber';
interface Piece { kind: Kind; turret: boolean; geo: THREE.BufferGeometry }
/** Level geometry, built once per (type, level) and shared by every instance. Turret/muzzle/fire coords are turret-local. */
interface Blueprint { pieces: Piece[]; turretAt?: V; muzzle?: V; fireAt?: V }

const UV = 0.5;
const UP = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const TAU = Math.PI * 2;
const v3 = (p: V) => new THREE.Vector3(p[0], p[1], p[2]);
const pick = <T,>(a: readonly T[], level: number): T => a[level - 1] as T;

/** Rotate (XYZ) then translate a primitive into place, with world-ish UVs. */
function solid(g: THREE.BufferGeometry, p: V = [0, 0, 0], r: V = [0, 0, 0]): THREE.BufferGeometry {
  g.rotateX(r[0]); g.rotateY(r[1]); g.rotateZ(r[2]);
  g.translate(p[0], p[1], p[2]);
  return boxUV(g, UV);
}
const box = (w: number, h: number, d: number, p?: V, r?: V) => solid(new THREE.BoxGeometry(w, h, d), p, r);
const cyl = (rt: number, rb: number, h: number, seg: number, p?: V, r?: V, open = false) =>
  solid(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), p, r);

/** Square-section beam from a to b. */
function beam(a: V, b: V, w: number, h = w): THREE.BufferGeometry {
  const A = v3(a), B = v3(b), d = B.clone().sub(A);
  const g = new THREE.BoxGeometry(w, h, d.length());
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(AXIS_Z, d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return boxUV(g, UV);
}

/** Capsule whose axis runs a to b (caps extend beyond both ends). */
function limb(r: number, a: V, b: V): THREE.BufferGeometry {
  const A = v3(a), B = v3(b), d = B.clone().sub(A);
  const g = new THREE.CapsuleGeometry(r, d.length(), 3, 8);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

/** Geometry (base at origin, tip +Y) aimed along dir and placed with its base at base. */
function aimed(g: THREE.BufferGeometry, dir: V, base: V): THREE.BufferGeometry {
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, v3(dir).normalize()));
  g.translate(base[0], base[1], base[2]);
  return boxUV(g, UV);
}

/** Collects primitives per material slot and merges them into one geometry per slot and space (world or turret). */
class Kit {
  private bins = new Map<string, { kind: Slot; turret: boolean; geos: THREE.BufferGeometry[] }>();
  private glows: Piece[] = [];
  add(kind: Slot, geo: THREE.BufferGeometry, turret = false) {
    const key = `${turret ? 'T' : 'W'}:${kind}`;
    let b = this.bins.get(key);
    if (!b) { b = { kind, turret, geos: [] }; this.bins.set(key, b); }
    b.geos.push(geo);
  }
  glow(kind: 'glowFrost' | 'glowEmber', geo: THREE.BufferGeometry, turret = false) {
    this.glows.push({ kind, turret, geo });
  }
  pieces(): Piece[] {
    const out: Piece[] = [];
    for (const b of this.bins.values()) out.push({ kind: b.kind, turret: b.turret, geo: mergeGeometries(b.geos)! });
    return [...out, ...this.glows];
  }
}

// ---------- materials ----------

const teamMats = new Map<string, THREE.Material>();
function cachedTeam(key: string, make: () => THREE.Material): THREE.Material {
  let m = teamMats.get(key);
  if (!m) { m = make(); teamMats.set(key, m); }
  return m;
}

function slotMaterial(kind: Slot, team: 0 | 1): THREE.Material {
  switch (kind) {
    case 'timber': return Mats.timber();
    case 'darkSteel': return Mats.darkSteel();
    case 'slate': return Mats.slate(1);
    case 'bark': return Mats.bark();
    case 'leather': return Mats.leather();
    case 'cloth': return Mats.cloth(team, teamBanner(team));
    case 'paint': return cachedTeam(`paint${team}`, () => new THREE.MeshStandardMaterial({ color: teamBanner(team), roughness: 0.8 }));
    case 'rune': return cachedTeam(`rune${team}`, () => new THREE.MeshStandardMaterial({
      color: teamColor(team), emissive: teamColor(team), emissiveIntensity: 0.6, roughness: 0.5,
    }));
  }
}

/** Per-instance: the game may pulse these, so they are not shared. */
function glowMaterial(kind: 'glowFrost' | 'glowEmber'): THREE.MeshStandardMaterial {
  return kind === 'glowFrost'
    ? new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x4fb4ff, emissiveIntensity: 2, roughness: 0.2 })
    : new THREE.MeshStandardMaterial({ color: 0x3a3c40, emissive: 0xff7a2a, emissiveIntensity: 1.5, roughness: 0.5, metalness: 0.7 });
}

// ---------- blueprints ----------

/** Watch Tower: timber frame, ballista on a raised platform. */
function arrowBlueprint(level: 1 | 2 | 3): Blueprint {
  const k = new Kit();
  const H = pick([3.2, 3.7, 4.2], level);
  const P = 0.55;
  const braces = pick([[1.3], [1.0, 2.2], [1.0, 2.2, 3.2]], level);
  const faceAt = (ax: number, s: number, u: number, y: number): V => (ax === 0 ? [u, y, s * P] : [s * P, y, u]);

  for (const sx of [-P, P]) for (const sz of [-P, P]) {
    k.add('timber', beam([sx, 0, sz], [sx, H, sz], 0.14));
    k.add('slate', box(0.42, 0.22, 0.42, [sx, 0.11, sz]));
  }
  for (const ax of [0, 1]) for (const s of [-1, 1]) {
    for (const y of braces) k.add('timber', beam(faceAt(ax, s, -P, y), faceAt(ax, s, P, y), 0.1));
    if (level > 1) {
      const levels = [0.22, ...braces, H - 0.04];
      for (let i = 0; i + 1 < levels.length; i++) {
        const y0 = levels[i] ?? 0, y1 = levels[i + 1] ?? 0;
        const flip = i % 2 === 1;
        k.add('timber', beam(faceAt(ax, s, flip ? P : -P, y0), faceAt(ax, s, flip ? -P : P, y1), 0.07));
      }
    }
  }
  // platform and rails
  for (const x of [-0.5, 0, 0.5]) k.add('timber', box(0.5, 0.08, 1.7, [x, H - 0.04, 0]));
  const RH = H + 0.5, R = 0.75;
  for (const s of [-R, R]) {
    k.add('timber', beam([-R, RH, s], [R, RH, s], 0.06));
    k.add('timber', beam([s, RH, -R], [s, RH, R], 0.06));
  }
  for (const sx of [-R, R]) for (const sz of [-R, R]) k.add('timber', beam([sx, H, sz], [sx, RH, sz], 0.06));
  // iron banding (L2+)
  if (level > 1) for (const sx of [-P, P]) for (const sz of [-P, P]) for (const y of [0.7, 2.0]) {
    k.add('darkSteel', box(0.2, 0.06, 0.2, [sx, y, sz]));
  }
  // team paint band just below the platform
  for (const s of [-1, 1]) {
    k.add('paint', box(1.2, 0.14, 0.03, [0, H - 0.6, s * (P + 0.08)]));
    k.add('paint', box(0.03, 0.14, 1.2, [s * (P + 0.08), H - 0.6, 0]));
  }
  // team pennant on a corner pole (L3)
  if (level === 3) {
    k.add('timber', beam([-0.85, H, -0.85], [-0.85, H + 1.1, -0.85], 0.05));
    k.add('cloth', solid(new THREE.PlaneGeometry(0.5, 0.9), [-0.58, H + 0.6, -0.85]));
  }

  // ballista turret, origin on top of the platform
  const T: V = [0, H + 0.12, 0];
  k.add('timber', cyl(0.2, 0.24, 0.24, 8, [0, 0, 0]), true);
  k.add('timber', beam([0, 0.12, -0.45], [0, 0.12, 0.02], 0.14, 0.16), true);
  k.add('timber', beam([0, 0.225, -0.1], [0, 0.225, 0.8], 0.04), true);
  k.add('darkSteel', cyl(0, 0.035, 0.1, 5, [0, 0.225, 0.85], [Math.PI / 2, 0, 0]), true);
  k.add('darkSteel', solid(new THREE.TorusGeometry(0.7, 0.035, 6, 20, Math.PI), [0, 0.13, 0], [Math.PI / 2, 0, 0]), true);
  k.add('darkSteel', box(1.4, 0.012, 0.012, [0, 0.13, 0]), true);
  return { pieces: k.pieces(), turretAt: T, muzzle: [0, 0.225, 0.9] };
}

/** Rime Totem: carved slate monolith with a floating ice crystal. */
function frostBlueprint(level: 1 | 2 | 3): Blueprint {
  const k = new Kit();
  const total = pick([2.2, 2.6, 3.0], level);
  const cL = pick([0.7, 0.8, 0.9], level);
  const S = total - cL - 0.35;                 // shaft height
  const rAt = (y: number) => 0.46 + (0.34 - 0.46) * ((y - 0.25) / S);

  k.add('slate', box(1.1, 0.25, 1.1, [0, 0.125, 0]));
  k.add('slate', cyl(0.34, 0.46, S, 6, [0, 0.25 + S / 2, 0]));
  // raised rune marks
  for (let i = 0; i < 6; i++) {
    const y = 0.25 + S * (i % 2 ? 0.34 : 0.66);
    const a = (i / 6) * TAU, r = rAt(y) * 0.9;
    k.add('slate', solid(new THREE.BoxGeometry(0.08, 0.2, 0.03), [Math.sin(a) * r, y, Math.cos(a) * r], [0, a, 0]));
  }
  // team rune ring
  const yb = 0.25 + S * 0.5;
  k.add('rune', cyl(rAt(yb) + 0.03, rAt(yb) + 0.03, 0.09, 6, [0, yb, 0], [0, 0, 0], true));
  // iron banding (L2+)
  if (level > 1) {
    for (const f of level === 2 ? [0.2, 0.8] : [0.15, 0.85]) {
      const y = 0.25 + S * f;
      k.add('darkSteel', cyl(rAt(y) + 0.04, rAt(y) + 0.04, 0.07, 6, [0, y, 0], [0, 0, 0], true));
    }
  }
  // floating crystal (glow): bipyramid plus orbiting shards
  const yc = total - cL / 2;
  const parts: THREE.BufferGeometry[] = [
    cyl(0, 0.2, cL * 0.55, 6, [0, yc + cL * 0.275, 0]),
    cyl(0.2, 0, cL * 0.45, 6, [0, yc - cL * 0.225, 0]),
  ];
  const shards = pick([0, 2, 4], level);
  for (let i = 0; i < shards; i++) {
    const a = (i / shards) * TAU + 0.6, tilt = 0.45;
    const dir: V = [Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)];
    const base: V = [Math.cos(a) * 0.38, yc + (i % 2 ? 0.1 : -0.12), Math.sin(a) * 0.38];
    parts.push(aimed(new THREE.CylinderGeometry(0, 0.07, 0.24, 5).translate(0, 0.12, 0), dir, base));
  }
  k.glow('glowFrost', mergeGeometries(parts)!);
  // carried banner (L3)
  if (level === 3) {
    const yb2 = 0.25 + S * 0.72;
    k.add('darkSteel', beam([0.4, yb2, 0], [0.9, yb2, 0], 0.04));
    k.add('cloth', solid(new THREE.PlaneGeometry(0.42, 0.8), [0.65, yb2 - 0.4, 0]));
  }
  return { pieces: k.pieces() };
}

/** Ember Catapult: slate block, timber A-frame, throwing arm ending in a fire bowl. */
function fireBlueprint(level: 1 | 2 | 3): Blueprint {
  const k = new Kit();
  const bh = pick([0.5, 0.7, 0.7], level);
  const axle = pick([1.1, 1.3, 1.4], level);

  k.add('slate', box(1.4, bh, 1.4, [0, bh / 2, 0]));
  for (const sx of [-0.45, 0.45]) {
    k.add('timber', beam([sx, bh, 0], [sx, axle, 0], 0.13));
    k.add('timber', beam([sx, axle, 0], [sx, bh, -0.55], 0.1));
  }
  k.add('darkSteel', cyl(0.05, 0.05, 1.0, 6, [0, axle, 0], [0, 0, Math.PI / 2]));
  k.add('paint', box(0.6, 0.22, 0.03, [0, bh * 0.6, 0.715]));
  if (level > 1) {
    for (const s of [-0.71, 0.71]) k.add('darkSteel', box(0.04, 0.05, 1.44, [s, bh * 0.75, 0]));
    for (const sx of [-0.45, 0.45]) k.add('darkSteel', box(0.19, 0.06, 0.19, [sx, bh + 0.35, 0]));
  }
  if (level === 3) {
    k.add('darkSteel', beam([0.45, axle, 0], [0.45, axle + 1.0, 0], 0.04));
    k.add('cloth', solid(new THREE.PlaneGeometry(0.44, 0.8), [0.68, axle + 0.5, 0]));
  }

  // throwing arm (turret, origin at the axle); 0.9 m long, tilted 45 degrees
  k.add('timber', solid(new THREE.BoxGeometry(0.14, 0.14, 1.1), [0, 0.247, 0.247], [-Math.PI / 4, 0, 0]), true);
  k.add('timber', box(0.22, 0.22, 0.22, [0, -0.14, -0.14]), true);
  k.glow('glowEmber', cyl(0.21, 0.14, 0.18, 10, [0, 0.676, 0.636]), true);
  return { pieces: k.pieces(), turretAt: [0, axle, 0], muzzle: [0, 0.82, 0.636], fireAt: [0, 0.766, 0.636] };
}

/** Palisade: sharpened bark logs lashed with leather, iron tips at L2+. No turret. */
function palisadeBlueprint(level: 1 | 2 | 3): Blueprint {
  const k = new Kit();
  const H = pick([1.8, 2.1, 2.42], level);
  const n = level === 1 ? 5 : 6;
  for (let i = 0; i < n; i++) {
    const x = -0.75 + (1.5 * i) / (n - 1);
    const h = H * (0.96 + 0.04 * Math.sin(i * 2.3));
    const z = i % 2 ? 0.05 : -0.02;
    const top = h - 0.04;
    k.add('bark', solid(new THREE.CylinderGeometry(0.03, 0.15, h, 7), [x, h / 2 - 0.04, z]));
    if (level > 1) k.add('darkSteel', cyl(0, 0.05, 0.2, 5, [x, top + 0.08, z]));
  }
  const straps = pick([[0.4, H - 0.45], [0.4, H * 0.5, H - 0.45], [0.4, H * 0.5, H - 0.45]], level);
  for (const y of straps) for (const z of [0.2, -0.2]) k.add('leather', box(1.84, 0.07, 0.04, [0, y, z]));
  k.add('paint', box(0.42, 0.3, 0.03, [0, H * 0.5, 0.23]));
  if (level === 3) {
    k.add('bark', beam([-0.82, 0, 0.25], [-0.82, H + 0.45, 0.25], 0.04));
    k.add('cloth', solid(new THREE.PlaneGeometry(0.5, 0.6), [-0.56, H, 0.25]));
  }
  return { pieces: k.pieces() };
}

/** Caltrops: iron spike clusters on a darkSteel plate. Upper levels add upright corner spikes. */
function spikesBlueprint(level: 1 | 2 | 3): Blueprint {
  const k = new Kit();
  k.add('darkSteel', box(1.8, 0.04, 1.8, [0, 0.02, 0]));
  for (const s of [-0.87, 0.87]) {
    k.add('darkSteel', beam([-0.87, 0.05, s], [0.87, 0.05, s], 0.06));
    k.add('darkSteel', beam([s, 0.05, -0.87], [s, 0.05, 0.87], 0.06));
  }
  k.add('paint', cyl(0.14, 0.14, 0.01, 12, [0, 0.045, 0]));

  const G = [-0.7, -0.23, 0.23, 0.7];
  const tilt = 0.9;
  let ci = 0;
  for (const x of G) for (const z of G) {
    if (Math.hypot(x, z) < 0.35) continue;
    const base: V = [x, 0.04, z];
    k.add('darkSteel', aimed(new THREE.CylinderGeometry(0, 0.035, 0.3, 4).translate(0, 0.15, 0), [0, 1, 0], base));
    for (let j = 0; j < 3; j++) {
      const a = ci * 0.7 + (j * TAU) / 3;
      const dir: V = [Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)];
      k.add('darkSteel', aimed(new THREE.CylinderGeometry(0, 0.035, 0.3, 4).translate(0, 0.15, 0), dir, base));
    }
    ci++;
  }
  if (level > 1) {
    const corners: V[] = [[-0.8, 0, -0.8], [0.8, 0, -0.8], [-0.8, 0, 0.8], [0.8, 0, 0.8]];
    if (level === 3) corners.push([0, 0, -0.8], [0, 0, 0.8], [-0.8, 0, 0], [0.8, 0, 0]);
    for (const c of corners) k.add('darkSteel', aimed(new THREE.CylinderGeometry(0, 0.045, 0.34, 5).translate(0, 0.17, 0), [0, 1, 0], [c[0], 0.04, c[2]]));
  }
  return { pieces: k.pieces() };
}

const BUILDERS: Record<BulwarkType, (level: 1 | 2 | 3) => Blueprint> = {
  arrow: arrowBlueprint,
  frost: frostBlueprint,
  fire: fireBlueprint,
  palisade: palisadeBlueprint,
  spikes: spikesBlueprint,
};
const blueprints = new Map<string, Blueprint>();
function blueprint(type: BulwarkType, level: 1 | 2 | 3): Blueprint {
  const key = `${type}${level}`;
  let bp = blueprints.get(key);
  if (!bp) { bp = BUILDERS[type](level); blueprints.set(key, bp); }
  return bp;
}

function instantiate(bp: Blueprint, team: 0 | 1, ghost?: THREE.Material): THREE.Group {
  const root = new THREE.Group();
  let turret: THREE.Group | null = null;
  if (bp.turretAt) {
    turret = new THREE.Group();
    turret.position.set(bp.turretAt[0], bp.turretAt[1], bp.turretAt[2]);
    root.add(turret);
    root.userData.turret = turret;
  }
  for (const p of bp.pieces) {
    const glow = p.kind === 'glowFrost' || p.kind === 'glowEmber';
    const mat = ghost ?? (glow ? glowMaterial(p.kind as 'glowFrost' | 'glowEmber') : slotMaterial(p.kind as Slot, team));
    const mesh = new THREE.Mesh(p.geo, mat);
    mesh.castShadow = !glow && !ghost;
    mesh.receiveShadow = !glow && !ghost;
    (p.turret && turret ? turret : root).add(mesh);
    if (glow) root.userData.glow = mesh;
  }
  if (turret && bp.muzzle) {
    const m = new THREE.Object3D();
    m.position.set(bp.muzzle[0], bp.muzzle[1], bp.muzzle[2]);
    turret.add(m);
    root.userData.muzzle = m;
  }
  if (turret && bp.fireAt && !ghost) {
    const f = makeFire(0.5);
    f.position.set(bp.fireAt[0], bp.fireAt[1], bp.fireAt[2]);
    turret.add(f);
  }
  return root;
}

/** Build a player-made defensive structure. Origin = ground centre; +Y up; it must fit a 2 m x 2 m footprint (keep within ~1.85 m).
 *  userData.turret?: THREE.Object3D  — part that the game rotates (rotation.y) to face targets (arrow, fire only)
 *  userData.muzzle?: THREE.Object3D  — empty Object3D marking where projectiles leave (child of turret)
 *  userData.glow?: THREE.Mesh        — emissive part the game may pulse (frost crystal, fire bowl) */
export function buildBulwarkModel(type: BulwarkType, level: 1 | 2 | 3, team: 0 | 1): THREE.Group {
  return instantiate(blueprint(type, level), team);
}

/** Translucent placement ghost of the same silhouette (level 1), single MeshBasicMaterial passed in so the game can tint it green/red. */
export function buildBulwarkGhost(type: BulwarkType, material: THREE.Material): THREE.Group {
  return instantiate(blueprint(type, 1), 0, material);
}

// ---------- wolf ----------

interface WolfGeo { body: THREE.BufferGeometry; head: THREE.BufferGeometry; eyes: THREE.BufferGeometry; tail: THREE.BufferGeometry; upper: THREE.BufferGeometry; lower: THREE.BufferGeometry }
let wolfGeoCache: WolfGeo | null = null;

/** Fur geometry carries a per-vertex colour so the dark muzzle and paws share the one fur material. */
function shade(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
  const n = g.attributes.position!.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(c), 3));
  return g;
}

function wolfGeo(): WolfGeo {
  if (wolfGeoCache) return wolfGeoCache;
  const sphere = (r: number, p: V, c = 1) => shade(solid(new THREE.SphereGeometry(r, 10, 8), p), c);
  const fur = (g: THREE.BufferGeometry, c = 1) => shade(boxUV(g, 1.5), c);
  wolfGeoCache = {
    body: mergeGeometries([
      fur(limb(0.18, [0, 0.68, -0.18], [0, 0.68, 0.18])),
      sphere(0.2, [0, 0.7, 0.24]),
      sphere(0.19, [0, 0.69, -0.26]),
      fur(limb(0.1, [0, 0.72, 0.3], [0, 0.86, 0.44])),
    ])!,
    head: mergeGeometries([
      sphere(0.14, [0, 0, 0]),
      shade(cyl(0, 0.05, 0.14, 5, [0.07, 0.15, -0.02], [0, 0, -0.15]), 1),
      shade(cyl(0, 0.05, 0.14, 5, [-0.07, 0.15, -0.02], [0, 0, 0.15]), 1),
      fur(limb(0.065, [0, -0.02, 0.08], [0, -0.04, 0.22]), 0.3),
      sphere(0.035, [0, -0.04, 0.25], 0.3),
    ])!,
    eyes: mergeGeometries([
      solid(new THREE.SphereGeometry(0.028, 6, 5), [0.075, 0.04, 0.125]),
      solid(new THREE.SphereGeometry(0.028, 6, 5), [-0.075, 0.04, 0.125]),
    ])!,
    tail: mergeGeometries([
      fur(limb(0.09, [0, 0, 0], [0, 0, -0.22])),
      sphere(0.13, [0, 0, -0.3]),
    ])!,
    upper: fur(limb(0.07, [0, 0, 0], [0, -0.21, 0])),
    lower: mergeGeometries([
      fur(limb(0.055, [0, 0, 0], [0, -0.2, 0])),
      sphere(0.06, [0, -0.24, 0.02], 0.75),
    ])!,
  };
  return wolfGeoCache;
}

const furMats = new Map<number, THREE.MeshStandardMaterial>();
function wolfFur(team: 0 | 1): THREE.MeshStandardMaterial {
  let m = furMats.get(team);
  if (!m) {
    m = Mats.fur().clone();
    m.color.setHex(team === 0 ? 0x8a8580 : 0x6a7480);
    m.vertexColors = true;
    furMats.set(team, m);
  }
  return m;
}
const eyeMats = new Map<number, THREE.MeshBasicMaterial>();
function wolfEyes(team: 0 | 1): THREE.MeshBasicMaterial {
  let m = eyeMats.get(team);
  if (!m) { m = new THREE.MeshBasicMaterial({ color: teamColor(team) }); eyeMats.set(team, m); }
  return m;
}

/** A grey-wolf mercenary (enemy "send" unit), ~0.8 m tall at the shoulder, ~1.4 m long, facing +Z.
 *  update(speed m/s, dt s) animates a procedural trot/gallop (leg swing, body bob, tail sway, head bob) blending to idle breathing at speed 0. */
export function buildWolf(team: 0 | 1): { root: THREE.Group; update(speed: number, dt: number): void } {
  const g = wolfGeo();
  const fur = wolfFur(team);
  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
    const o = new THREE.Mesh(geo, m);
    o.castShadow = shadow;
    o.receiveShadow = shadow;
    return o;
  };

  const root = new THREE.Group();
  const torso = new THREE.Group();
  const head = new THREE.Group();
  head.position.set(0, 0.9, 0.5);
  head.add(mesh(g.head, fur), mesh(g.eyes, wolfEyes(team), false));
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.7, -0.34);
  tailPivot.add(mesh(g.tail, fur));
  torso.add(mesh(g.body, fur), head, tailPivot);
  root.add(torso);

  // diagonal gait pairs: front-left/hind-right and front-right/hind-left
  const legs = [
    { x: 0.12, z: 0.28, o: 0 }, { x: -0.12, z: 0.28, o: Math.PI },
    { x: 0.12, z: -0.28, o: Math.PI }, { x: -0.12, z: -0.28, o: 0 },
  ].map(({ x, z, o }) => {
    const hip = new THREE.Group();
    hip.position.set(x, 0.6, z);
    const knee = new THREE.Group();
    knee.position.set(0, -0.28, 0);
    hip.add(mesh(g.upper, fur), knee);
    knee.add(mesh(g.lower, fur));
    root.add(hip);
    return { hip, knee, o };
  });

  let phase = 0, t = 0, blend = 0;
  return {
    root,
    update(speed: number, dt: number) {
      const sp = Math.min(Math.max(speed, 0), 12);
      t += dt;
      blend += (Math.min(sp / 1.2, 1) - blend) * (1 - Math.exp(-dt * 8));
      phase = (phase + dt * TAU * (1.5 + 0.28 * sp)) % TAU;
      const swing = (0.1 + 0.03 * sp) * blend;
      const flex = (0.35 + 0.04 * sp) * blend;
      for (const l of legs) {
        const a = phase + l.o;
        l.hip.rotation.x = -Math.sin(a) * swing;
        l.knee.rotation.x = Math.max(0, Math.cos(a)) * flex;
      }
      torso.position.y = Math.cos(2 * phase) * 0.02 * blend;
      torso.rotation.x = Math.sin(phase) * 0.02 * blend;
      torso.scale.y = 1 + (1 - blend) * Math.sin(t * 2.6) * 0.012;
      head.rotation.x = (1 - blend) * (-0.03 + Math.sin(t * 0.9) * 0.05) + blend * (0.12 + Math.sin(2 * phase + 0.6) * 0.05);
      head.rotation.y = (1 - blend) * Math.sin(t * 0.5) * 0.15;
      tailPivot.rotation.x = 0.35 - 0.2 * blend;
      tailPivot.rotation.y = Math.sin(t * (2.5 + 2 * blend)) * (0.18 + 0.12 * blend);
    },
  };
}
