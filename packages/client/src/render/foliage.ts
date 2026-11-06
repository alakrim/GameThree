import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type MapDef, Rng, terrainMasks, fbm, terrainHeight } from '@lumen/shared';
import { Mats } from './materials.js';
import { chunkedInstances, mat4 } from './chunks.js';
import type { QualitySettings } from './quality.js';

export const windUniform = { value: 0 };

/** Inject a gentle wind sway into a material (scaled by local height; phase from instance position). */
function addWind(m: THREE.Material, strength: number, key: string) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windUniform;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = vec3(instanceMatrix[3]);
#else
  vec3 ip = vec3(0.0);
#endif
  float sway = sin(uWind * 1.3 + ip.x * 0.21 + ip.z * 0.17) + 0.4 * sin(uWind * 3.1 + ip.x * 0.7);
  float hk = max(position.y, 0.0);
  transformed.x += sway * ${strength.toFixed(4)} * hk * hk;
  transformed.z += sway * ${(strength * 0.6).toFixed(4)} * hk * hk;`);
  };
  m.customProgramCacheKey = () => `wind-${key}`;
}

/** Procedurally painted pine twig card (alpha). */
function needleTexture(): THREE.CanvasTexture {
  const W = 256, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const rng = new Rng(77);
  const twig = (x0: number, y0: number, x1: number, y1: number, len: number, width: number) => {
    g.strokeStyle = '#3b2a1c'; g.lineWidth = width; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    const n = Math.hypot(x1 - x0, y1 - y0) / 2.2;
    for (let i = 0; i < n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const ang = Math.atan2(y1 - y0, x1 - x0);
      for (const side of [-1, 1]) {
        const a = ang + side * (0.75 + rng.range(-0.2, 0.25));
        const l = len * (1 - t * 0.55) * rng.range(0.75, 1.1);
        const shade = rng.range(0, 1);
        g.strokeStyle = `rgb(${52 + shade * 30 | 0},${84 + shade * 42 | 0},${50 + shade * 24 | 0})`;
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
    }
  };
  twig(W / 2, H - 6, W / 2, 10, 46, 5);
  for (let i = 0; i < 9; i++) {
    const y = H - 60 - i * 48, side = i % 2 ? 1 : -1;
    twig(W / 2, y, W / 2 + side * rng.range(70, 105), y - rng.range(50, 90), 26, 2.4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** One pine: tapered trunk + whorls of drooping needle cards, normals bent upward for soft canopy lighting. */
function pineGeometry(rng: Rng): { trunk: THREE.BufferGeometry; needles: THREE.BufferGeometry } {
  const H = 1; // unit height; scaled per instance
  const trunk = new THREE.CylinderGeometry(0.006, 0.028, H * 0.9, 7, 3);
  trunk.translate(0, H * 0.45, 0); // ends inside the crown
  const tuv = trunk.attributes.uv!;
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) * 2, tuv.getY(i) * 6);
  const cards: THREE.BufferGeometry[] = [];
  const levels = 15;
  for (let l = 0; l < levels; l++) {
    const f = l / (levels - 1);
    const y = 0.22 + f * 0.76;
    const r = 0.27 * Math.pow(1 - f, 0.85) + 0.035;
    const count = Math.max(3, Math.round(8 - f * 4));
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + l * 1.3 + rng.range(-0.3, 0.3);
      const len = r * rng.range(0.85, 1.15), w = len * 0.62;
      const droop = len * rng.range(0.35, 0.55);
      const g = new THREE.BufferGeometry();
      // Quad from trunk (v=0) outwards (v=1), drooping.
      const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
      const p = [
        -px * w * 0.25, y, -pz * w * 0.25, px * w * 0.25, y, pz * w * 0.25,
        dx * len - px * w * 0.5, y - droop, dz * len - pz * w * 0.5, dx * len + px * w * 0.5, y - droop, dz * len + pz * w * 0.5,
      ];
      const up = new THREE.Vector3(dx * 0.55, 0.85, dz * 0.55).normalize();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([...up.toArray(), ...up.toArray(), ...up.toArray(), ...up.toArray()], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0.3, 0, 0.7, 0, 0, 1, 1, 1], 2));
      g.setIndex([0, 2, 1, 1, 2, 3]);
      cards.push(g);
    }
  }
  // Crown: two crossed vertical cards.
  for (const a of [0, Math.PI / 2]) {
    const g = new THREE.PlaneGeometry(0.09, 0.16); g.rotateY(a); g.translate(0, 0.93, 0);
    const n = g.attributes.normal!; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    cards.push(g);
  }
  return { trunk, needles: mergeGeometries(cards)! };
}

export interface Foliage { group: THREE.Group; update(t: number, camPos: THREE.Vector3, dt: number): void }

export function buildFoliage(map: MapDef, q: QualitySettings): Foliage {
  const group = new THREE.Group();
  const rng = new Rng(map.seed ^ 0x51ed);
  const tex = needleTexture();
  const needleMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.92, color: 0xffffff });
  addWind(needleMat, 0.05, 'needles');
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.42, side: THREE.DoubleSide });
  const bark = Mats.bark();

  const variants = [pineGeometry(new Rng(1)), pineGeometry(new Rng(2))];
  const trunkM: THREE.Matrix4[][] = [[], []], needleM: THREE.Matrix4[][] = [[], []];
  const addPine = (x: number, simY: number, h: number) => {
    const v = rng.int(0, 2);
    const ground = terrainHeight(map, x, simY);
    const wScale = h * rng.range(0.85, 1.15);
    const m = mat4(x, ground - 0.3, -simY, rng.range(0, Math.PI * 2), wScale, h, wScale, rng.range(-0.03, 0.03), rng.range(-0.03, 0.03));
    trunkM[v]!.push(m); needleM[v]!.push(m);
  };
  // Groves (colliding obstacles) are filled with pines.
  for (const o of map.obstacles) {
    if (o.kind !== 'grove') continue;
    const n = Math.max(2, Math.min(9, Math.round((o.r * o.r) / 2.6)));
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2), d = i === 0 ? 0 : Math.sqrt(rng.next()) * o.r * 0.8;
      addPine(o.x + Math.cos(a) * d, o.y + Math.sin(a) * d, rng.range(9, 16));
    }
  }
  // Valley-rim forest climbing the lower mountain slopes (outside the walkable area).
  for (let i = 0; i < q.rimTrees * 3 && trunkM[0]!.length + trunkM[1]!.length < q.rimTrees + 600; i++) {
    const x = rng.range(-map.half - 90, map.half + 90), y = rng.range(-map.half - 90, map.half + 90);
    const r = Math.max(Math.abs(x), Math.abs(y));
    if (r < map.half - 3) continue;
    const h0 = terrainHeight(map, x, y);
    if (h0 > 38 || fbm(x * 0.03, y * 0.03, 2, 5) < 0.42) continue;
    const slope = Math.abs(terrainHeight(map, x + 1.5, y) - h0) + Math.abs(terrainHeight(map, x, y + 1.5) - h0);
    if (slope > 2.6) continue;
    addPine(x, y, rng.range(10, 19));
  }
  for (let v = 0; v < 2; v++) {
    group.add(chunkedInstances(variants[v]!.trunk, bark, trunkM[v]!, 48, { castShadow: q.shadows, receiveShadow: true }));
    group.add(chunkedInstances(variants[v]!.needles, needleMat, needleM[v]!, 48, { castShadow: q.shadows, receiveShadow: true, depthMat }));
  }

  // Grass tufts.
  if (q.grass > 0) {
    const blades: THREE.BufferGeometry[] = [];
    for (let b = 0; b < 7; b++) {
      const g = new THREE.PlaneGeometry(0.05, 0.55, 1, 3);
      g.translate(0, 0.275, 0);
      const p = g.attributes.position!;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) * (1 - y / 0.6)); p.setZ(i, (y * y) * 0.5); }
      g.rotateY((b / 7) * Math.PI * 2 + b); g.translate(Math.cos(b * 2.1) * 0.12, 0, Math.sin(b * 2.1) * 0.12);
      g.scale(1, 0.75 + (b % 3) * 0.18, 1);
      blades.push(g);
    }
    const tuft = mergeGeometries(blades)!;
    const n = tuft.attributes.normal!, pp = tuft.attributes.position!;
    const col = new Float32Array(pp.count * 3);
    for (let i = 0; i < n.count; i++) {
      n.setXYZ(i, 0, 1, 0);
      const t = Math.min(1, pp.getY(i) / 0.6);
      col.set([0.13 + t * 0.32, 0.17 + t * 0.3, 0.07 + t * 0.1], i * 3);
    }
    tuft.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.95 });
    addWind(grassMat, 0.35, 'grass');
    const mats: THREE.Matrix4[] = [];
    for (let i = 0; i < q.grass * 6 && mats.length < q.grass; i++) {
      const x = rng.range(-map.half + 2, map.half - 2), y = rng.range(-map.half + 2, map.half - 2);
      const m = terrainMasks(map, x, y);
      if (m.lane > 0.15 || m.base > 0.05 || m.river > 0.1 || fbm(x * 0.045, y * 0.045, 3, 23) > 0.64) continue;
      if (map.obstacles.some((o) => (x - o.x) ** 2 + (y - o.y) ** 2 < (o.r + 0.4) ** 2)) continue;
      if (fbm(x * 0.09, y * 0.09, 2, 31) < 0.4) continue; // clumpy distribution
      const s = rng.range(0.7, 1.35);
      mats.push(mat4(x, terrainHeight(map, x, y) - 0.03, -y, rng.range(0, 6.28), s, s * rng.range(0.8, 1.3), s));
    }
    group.add(chunkedInstances(tuft, grassMat, mats, 24, { receiveShadow: true }));
  }

  // Drifting snow around the camera.
  const snowN = q.snow;
  const sp = new Float32Array(snowN * 3);
  for (let i = 0; i < snowN; i++) sp.set([rng.range(-30, 30), rng.range(0, 24), rng.range(-30, 30)], i * 3);
  const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const flake = document.createElement('canvas'); flake.width = flake.height = 32;
  const fg = flake.getContext('2d')!; const grd = fg.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); fg.fillStyle = grd; fg.fillRect(0, 0, 32, 32);
  const snow = new THREE.Points(sGeo, new THREE.PointsMaterial({ size: 0.09, map: new THREE.CanvasTexture(flake), transparent: true, depthWrite: false, opacity: 0.85, color: 0xf4f7ff }));
  snow.frustumCulled = false;
  group.add(snow);

  return {
    group,
    update(t, cam, dt) {
      windUniform.value = t;
      // Flakes live in world space and are wrapped into a 60 m box around the camera (no "attached to lens" look).
      const a = sGeo.attributes.position as THREE.BufferAttribute;
      const wrap = (v: number, c: number, half: number) => c + ((((v - c + half) % (half * 2)) + half * 2) % (half * 2)) - half;
      for (let i = 0; i < snowN; i++) {
        const x = a.getX(i) + (0.6 + Math.sin(t * 0.5 + i) * 0.4) * dt;
        const y = a.getY(i) - (0.9 + (i % 5) * 0.12) * dt;
        const z = a.getZ(i) + Math.cos(t * 0.3 + i * 0.7) * 0.3 * dt;
        a.setXYZ(i, wrap(x, cam.x, 30), wrap(y, cam.y, 12), wrap(z, cam.z, 30));
      }
      a.needsUpdate = true;
    },
  };
}
