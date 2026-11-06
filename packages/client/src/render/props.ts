import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type MapDef, Rng, terrainHeight, FORT_WALL_R, gateAngles, FORT_GATE_HALF } from '@lumen/shared';
import { loadModel, bakeModel } from '../assets.js';
import { Mats, boxUV } from './materials.js';
import { chunkedInstances, mat4 } from './chunks.js';
import { makeFire } from './fire.js';
import { PALETTE, teamColor, teamBanner } from './palette.js';
import type { QualitySettings } from './quality.js';

export interface Props { group: THREE.Group; update(t: number): void }

export async function buildProps(map: MapDef, q: QualitySettings): Promise<Props> {
  const group = new THREE.Group();
  const rng = new Rng(map.seed ^ 0xab);
  const H = (x: number, y: number) => terrainHeight(map, x, y);
  const flickers: { light: THREE.PointLight; base: number; seed: number }[] = [];
  const banners: THREE.Mesh[] = [];

  const rockIds = ['rock_moss_set_01', 'rock_moss_set_02', 'rock_07', 'rock_09'];
  const [log, firePit, ...rockModels] = await Promise.all(
    ['dead_tree_trunk', 'stone_fire_pit', ...rockIds.map((r) => `${r}_lod`), ...(q.tier === 'low' ? [] : rockIds)].map(loadModel),
  );
  // Small/scattered stones always use the LOD; boulders use full detail except on the low tier.
  const rocksLod = rockModels.slice(0, 4).map((g) => bakeModel(g!));
  const rocks = q.tier === 'low' ? rocksLod : rockModels.slice(4).map((g) => bakeModel(g!));

  // ---- Boulders (colliding obstacles) + scattered small stones ------------------------------
  const rockMats: THREE.Matrix4[][] = rocks.map(() => []);
  const pebbleMats: THREE.Matrix4[][] = rocksLod.map(() => []);
  for (const o of map.obstacles) {
    if (o.kind !== 'rock') continue;
    const v = o.variant % rocks.length;
    const s = o.r * 2.3;
    rockMats[v]!.push(mat4(o.x, H(o.x, o.y) - 0.4, -o.y, rng.range(0, 6.28), s, s * rng.range(0.8, 1.2), s));
  }
  for (let i = 0; i < 260; i++) {
    const x = rng.range(-map.half, map.half), y = rng.range(-map.half, map.half);
    if (map.obstacles.some((o) => (x - o.x) ** 2 + (y - o.y) ** 2 < (o.r + 3) ** 2)) continue;
    const s = rng.range(0.25, 0.7), v = rng.int(0, rocksLod.length);
    pebbleMats[v]!.push(mat4(x, H(x, y) - s * 0.25, -y, rng.range(0, 6.28), s));
  }
  rocks.forEach((r, i) => group.add(chunkedInstances(r.geometry, r.material, rockMats[i]!, 50, { castShadow: q.shadows })));
  rocksLod.forEach((r, i) => group.add(chunkedInstances(r.geometry, r.material, pebbleMats[i]!, 50)));

  // ---- Fallen logs inside groves -------------------------------------------------------------
  const logB = bakeModel(log!);
  const logMats: THREE.Matrix4[] = [];
  for (const o of map.obstacles) if (o.kind === 'grove' && o.variant === 1) logMats.push(mat4(o.x, H(o.x, o.y) - 0.05, -o.y, rng.range(0, 6.28), o.r * 1.6));
  group.add(chunkedInstances(logB.geometry, logB.material, logMats, 60, { castShadow: q.shadows }));

  // ---- Lantern posts along roads -------------------------------------------------------------
  const post = boxUV(new THREE.BoxGeometry(0.22, 2.6, 0.22).translate(0, 1.3, 0), 0.6);
  const arm = boxUV(new THREE.BoxGeometry(0.7, 0.12, 0.12).translate(0.3, 2.45, 0), 0.6);
  const postGeo = mergeGeometries([post, arm])!;
  const cage = new THREE.CylinderGeometry(0.16, 0.12, 0.34, 6).translate(0.58, 2.15, 0);
  const glass = new THREE.CylinderGeometry(0.1, 0.1, 0.24, 6).translate(0.58, 2.15, 0);
  const postMats: THREE.Matrix4[] = [];
  for (const lane of Object.values(map.lanes)) for (let i = 0; i < lane.length - 1; i++) {
    const a = lane[i]!, b = lane[i + 1]!;
    const L = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
    for (let d = 16; d < L - 8; d += 18) {
      const side = Math.round(d / 18) % 2 ? 1 : -1;
      const x = a.x + ((b.x - a.x) * d) / L + nx * side * (map.laneHalfWidth + 0.6);
      const y = a.y + ((b.y - a.y) * d) / L + ny * side * (map.laneHalfWidth + 0.6);
      if (Math.hypot(x - map.bases[0].pos.x, y - map.bases[0].pos.y) < 16 || Math.hypot(x - map.bases[1].pos.x, y - map.bases[1].pos.y) < 16) continue;
      postMats.push(mat4(x, H(x, y) - 0.1, -y, Math.atan2(-ny * side, -nx * side), 1)); // arm (+x) points toward the road
    }
  }
  group.add(chunkedInstances(postGeo, Mats.timber(), postMats, 60, { castShadow: q.shadows }));
  group.add(chunkedInstances(cage, Mats.darkSteel(), postMats, 60));
  group.add(chunkedInstances(glass, new THREE.MeshStandardMaterial({ color: 0x331a08, emissive: PALETTE.fire, emissiveIntensity: 3.2 }), postMats, 60));

  // ---- Forts ---------------------------------------------------------------------------------
  const pit = bakeModel(firePit!);
  const gates = gateAngles(map);
  for (const team of [0, 1] as const) {
    const c = map.bases[team].pos;
    const mirror = team === 1 ? Math.PI : 0;
    const fort = new THREE.Group();
    const cy = H(c.x, c.y);
    fort.position.set(c.x, cy, -c.y);
    group.add(fort);

    // Ring wall: segments between gates, with crenellations.
    const wallParts: THREE.BufferGeometry[] = [];
    const gateHalf = FORT_GATE_HALF / FORT_WALL_R;
    const seg = 48;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
      const simA = am + mirror;
      if (gates.some((g) => Math.abs(Math.atan2(Math.sin(simA - mirror - g), Math.cos(simA - mirror - g))) < gateHalf + 0.03)) continue;
      const len = 2 * FORT_WALL_R * Math.sin((a1 - a0) / 2) + 0.12;
      const g = new THREE.BoxGeometry(len, 3.6, 1.3);
      boxUV(g, 0.35);
      g.translate(0, 1.6, 0);
      const merlons = [-len / 3, len / 3].map((mx) => boxUV(new THREE.BoxGeometry(len * 0.22, 0.6, 1.3), 0.35).translate(mx, 3.7, 0));
      const piece = mergeGeometries([g, ...merlons])!;
      piece.rotateY(simA + Math.PI / 2); // local +x along the ring tangent
      piece.translate(Math.cos(simA) * FORT_WALL_R, 0, -Math.sin(simA) * FORT_WALL_R);
      wallParts.push(piece);
    }
    const walls = new THREE.Mesh(mergeGeometries(wallParts)!, Mats.slate(1));
    walls.castShadow = q.shadows; walls.receiveShadow = true;
    fort.add(walls);

    // Gate towers flank each lane exit.
    for (const g0 of gates) {
      for (const s of [-1, 1]) {
        const a = g0 + mirror + s * (gateHalf + 0.05);
        const tower = new THREE.Mesh(boxUV(new THREE.CylinderGeometry(0.95, 1.1, 5, 10).translate(0, 2.2, 0), 0.35), Mats.slate(1));
        tower.position.set(Math.cos(a) * FORT_WALL_R, 0, -Math.sin(a) * FORT_WALL_R);
        tower.castShadow = q.shadows; tower.receiveShadow = true;
        const cap = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.5, 10), Mats.timber());
        cap.position.y = 5.45; tower.add(cap);
        fort.add(tower);
        // Banner pole on every tower.
        fort.add(banner(team, tower.position.x, tower.position.z, banners));
      }
    }

    // Heartstone: carved monolith with glowing runes.
    const heart = new THREE.Group();
    const stoneGeo = boxUV(new THREE.CylinderGeometry(0.7, 1.15, 5.5, 6, 1).translate(0, 2.75, 0), 0.4);
    const stone = new THREE.Mesh(stoneGeo, Mats.slate(1));
    stone.castShadow = q.shadows;
    heart.add(stone);
    const runeMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: teamColor(team), emissiveIntensity: 4, map: runeTexture(), emissiveMap: runeTexture(), transparent: true });
    for (let k = 0; k < 6; k++) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 4.4), runeMat);
      const a = (k / 6) * Math.PI * 2; // hexagon face centres of the CylinderGeometry
      face.position.set(Math.cos(a) * 0.84, 2.75, Math.sin(a) * 0.84);
      face.rotation.y = Math.PI / 2 - a; // plane normal (+z) points outward
      face.rotateX(-0.08);               // follow the monolith's taper
      heart.add(face);
    }
    const hl = new THREE.PointLight(teamColor(team), 30, 22, 1.6); hl.position.y = 4.5; heart.add(hl);
    flickers.push({ light: hl, base: 30, seed: team * 3.1 });
    fort.add(heart);

    // Standing-stone circle: photoscanned boulders stretched upright into weathered menhirs.
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + 0.3;
      const src = (q.tier === 'low' ? rocksLod : rocks)[k % 2]!; // rounder mossy boulders read as stone at any LOD
      const s = new THREE.Mesh(src.geometry, src.material);
      const h = rng.range(2.6, 3.8);
      s.scale.set(1.3, h / src.height, 1.1);
      s.position.set(Math.cos(a) * 6.5, -0.25, Math.sin(a) * 6.5);
      s.rotation.set(rng.range(-0.05, 0.05), -a, rng.range(-0.07, 0.07));
      s.castShadow = q.shadows; s.receiveShadow = true;
      fort.add(s);
    }

    // Braziers with fire + flickering light (lights capped per tier).
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const bx = Math.cos(a) * 9.5, bz = Math.sin(a) * 9.5;
      const p = new THREE.Mesh(pit.geometry, pit.material);
      p.scale.setScalar(1.3); p.position.set(bx, 0, bz); p.receiveShadow = true;
      fort.add(p);
      const f = makeFire(0.9); f.position.set(bx, 0.25, bz); fort.add(f);
      if (k < q.fortLights) {
        const l = new THREE.PointLight(PALETTE.fire, 18, 14, 1.8); l.position.set(bx, 1.4, bz);
        fort.add(l); flickers.push({ light: l, base: 18, seed: k * 1.7 + team });
      }
    }
  }

  return {
    group,
    update(t) {
      for (const f of flickers) f.light.intensity = f.base * (0.82 + 0.12 * Math.sin(t * 9 + f.seed) + 0.08 * Math.sin(t * 23.7 + f.seed * 3));
      for (const b of banners) (b.material as THREE.MeshStandardMaterial).userData.time!.value = t;
    },
  };
}

/** Team banner: timber pole + cloth with a travelling-wave vertex shader. */
function banner(team: 0 | 1, x: number, z: number, list: THREE.Mesh[]): THREE.Group {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 9, 6).translate(0, 4.5, 0), Mats.timber());
  g.add(pole);
  const cloth = new THREE.PlaneGeometry(1.4, 3, 10, 10).translate(0.72, 6.9, 0);
  const mat = Mats.cloth(team, teamBanner(team)).clone();
  const time = { value: 0 };
  mat.userData.time = time;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
float k = clamp((position.x - 0.02) / 1.4, 0.0, 1.0);
transformed.z += sin(position.x * 3.0 - uT * 4.0 + position.y * 0.6) * 0.22 * k;
transformed.y -= k * k * 0.15;`);
  };
  mat.customProgramCacheKey = () => `banner-${team}`;
  const m = new THREE.Mesh(cloth, mat);
  m.castShadow = true;
  // Clan sigil stripe.
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.18).translate(0.72, 5.6, 0.01), new THREE.MeshStandardMaterial({ color: teamColor(team), side: THREE.DoubleSide, roughness: 0.8 }));
  g.add(m, stripe);
  list.push(m);
  return g;
}

let runeTex: THREE.CanvasTexture | null = null;
function runeTexture(): THREE.CanvasTexture {
  if (runeTex) return runeTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 384;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 384);
  g.strokeStyle = '#fff'; g.lineWidth = 3.5; g.lineCap = 'round';
  const rng = new Rng(9);
  for (let i = 0; i < 9; i++) {
    const y = 22 + i * 40, cx = 32;
    g.beginPath(); g.moveTo(cx, y - 14); g.lineTo(cx, y + 14);
    for (let k = 0; k < 2; k++) { const s = rng.next() < 0.5 ? -1 : 1, yy = y - 12 + rng.range(0, 22); g.moveTo(cx, yy); g.lineTo(cx + s * 11, yy + rng.range(-10, 10)); }
    g.stroke();
  }
  runeTex = new THREE.CanvasTexture(c); runeTex.colorSpace = THREE.SRGBColorSpace;
  return runeTex;
}
