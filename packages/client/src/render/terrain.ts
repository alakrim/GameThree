import * as THREE from 'three';
import { type MapDef, terrainHeight, terrainMasks, fbm, WATER_LEVEL } from '@lumen/shared';
import { pbr } from '../assets.js';
import type { QualitySettings } from './quality.js';

/** Sim (x, y) -> world (x, h, -y). The only conversion point in the client. */
export const toWorld = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export interface TerrainView { mesh: THREE.Mesh; water: THREE.Mesh; heightAt(simX: number, simY: number): number; update(t: number): void }

export function buildTerrain(map: MapDef, q: QualitySettings): TerrainView {
  // Non-uniform grid: ~1 m cells across the valley, stretching to coarse cells for the distant mountains.
  const inner = map.half + 14, outer = 650;
  const nIn = q.terrainSegments, nOut = Math.round(q.terrainSegments * 0.3);
  const coords: number[] = [];
  for (let i = 0; i <= nOut; i++) { const t = i / nOut; coords.push(-outer + (outer - inner) * (1 - (1 - t) ** 1.6) * 1); }
  coords.pop();
  for (let i = 0; i <= nIn; i++) coords.push(-inner + (2 * inner * i) / nIn);
  for (let i = 1; i <= nOut; i++) { const t = i / nOut; coords.push(inner + (outer - inner) * (t ** 1.6)); }
  const N = coords.length;
  const pos = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = coords[i]!, z = coords[j]!;
    const k = (j * N + i) * 3;
    pos[k] = x; pos[k + 1] = terrainHeight(map, x, -z); pos[k + 2] = z;
  }
  const idx: number[] = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // Per-vertex splat weights: A = (road, cobble, rock, snow), B = (forest floor, wetness, -, -). Grass is the remainder.
  const nrm = geo.attributes.normal!;
  const A = new Float32Array(N * N * 4), B = new Float32Array(N * N * 4);
  const groves = map.obstacles.filter((o) => o.kind === 'grove');
  for (let v = 0; v < N * N; v++) {
    const x = pos[v * 3]!, h = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!, sy = -z;
    const m = terrainMasks(map, x, sy);
    const ny = nrm.getY(v);
    const n1 = fbm(x * 0.08, sy * 0.08, 3, 11);
    const road = Math.min(1, m.lane * (1 - m.base) * (0.85 + n1 * 0.3) + m.river * 0.9);
    const cobble = m.base;
    const rock = Math.max(1 - smooth(0.62, 0.86, ny), smooth(25, 60, h) * 0.35);
    const snow = Math.max(smooth(22, 48, h + (n1 - 0.5) * 20) * smooth(0.55, 0.75, ny), smooth(0.64, 0.8, fbm(x * 0.045, sy * 0.045, 3, 23) + (n1 - 0.5) * 0.12) * 0.75 * (1 - m.lane) * (1 - m.base) * (1 - m.river) * (1 - m.edge));
    let forest = 0;
    for (const o of groves) { const d = Math.hypot(x - o.x, sy - o.y); if (d < o.r + 4) forest = Math.max(forest, 1 - smooth(o.r, o.r + 4, d)); }
    forest = Math.max(forest * 0.9, m.edge * 0.6) * (1 - m.lane);
    A.set([road, cobble, rock, snow], v * 4);
    B.set([forest, Math.max(0, 1 - Math.abs(h - WATER_LEVEL) * 1.5) * m.river, 0, 0], v * 4);
  }
  geo.setAttribute('aSplatA', new THREE.BufferAttribute(A, 4));
  geo.setAttribute('aSplatB', new THREE.BufferAttribute(B, 4));

  const t = (n: string) => pbr(n, q.tier === 'low' ? 2 : 8);
  const uniforms = {
    tGrassC: { value: t('grass').color }, tGrassN: { value: t('grass').normal },
    tForestC: { value: t('forest').color },
    tRockC: { value: t('rock').color }, tRockN: { value: t('rock').normal },
    tSnowC: { value: t('snow').color },
    tRoadC: { value: t('road').color }, tRoadN: { value: t('road').normal },
    tCobbleC: { value: t('cobble').color },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aSplatA; attribute vec4 aSplatB;
varying vec4 vSA; varying vec4 vSB; varying vec3 vWPos; varying vec3 vWN;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vSA = aSplatA; vSB = aSplatB; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tGrassC, tGrassN, tForestC, tRockC, tRockN, tSnowC, tRoadC, tRoadN, tCobbleC;
varying vec4 vSA; varying vec4 vSB; varying vec3 vWPos; varying vec3 vWN;
vec3 gW; // blended weights shared between colour/normal passes
float wRoad, wCobble, wRock, wSnow, wForest, wGrass, wWet;
void terrainWeights(){
  wRoad = vSA.x; wCobble = vSA.y; wRock = vSA.z; wSnow = vSA.w; wForest = vSB.x; wWet = vSB.y;
  float rest = 1.0;
  wSnow *= rest; rest -= wSnow; rest = max(rest, 0.0);
  wRock = min(wRock, 1.0) * rest; rest -= wRock;
  wCobble *= rest; rest -= wCobble;
  wRoad *= rest; rest -= wRoad;
  wForest *= rest; rest -= wForest;
  wGrass = max(rest, 0.0);
}
vec3 triRock(vec3 p, vec3 n){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture2D(tRockC, p.zy * 0.12).rgb * w.x + texture2D(tRockC, p.xz * 0.12).rgb * w.y + texture2D(tRockC, p.xy * 0.12).rgb * w.z;
}`)
      .replace('#include <map_fragment>', `
terrainWeights();
vec2 uvw = vec2(vWPos.x, vWPos.z);
float macro = texture2D(tGrassC, uvw * 0.013).g;           // large-scale variation hides tiling
vec3 cGrass = texture2D(tGrassC, uvw * 0.22).rgb * mix(0.72, 1.18, macro) * vec3(0.8, 0.86, 0.68); // colder, less saturated northern grass
vec3 cForest = texture2D(tForestC, uvw * 0.2).rgb * 0.8;
vec3 cRock = triRock(vWPos, normalize(vWN)) * 0.95;
vec3 cSnow = texture2D(tSnowC, uvw * 0.15).rgb * vec3(0.86, 0.9, 0.96); // cool, slightly dirty snow
vec3 cRoad = texture2D(tRoadC, uvw * 0.3).rgb * vec3(0.95, 0.9, 0.82);
vec3 cCobble = texture2D(tCobbleC, uvw * 0.3).rgb;
vec3 albedo = cGrass * wGrass + cForest * wForest + cRock * wRock + cSnow * wSnow + cRoad * wRoad + cCobble * wCobble;
albedo *= mix(1.0, 0.55, wWet);                             // wet riverbanks darken
diffuseColor.rgb *= albedo;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.97, 0.5, wWet) - wSnow * 0.25;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 nG = texture2D(tGrassN, uvw * 0.22).xyz * 2.0 - 1.0;
  vec3 nR = texture2D(tRockN, uvw * 0.12).xyz * 2.0 - 1.0;
  vec3 nD = texture2D(tRoadN, uvw * 0.3).xyz * 2.0 - 1.0;
  vec3 nt = normalize(nG * (wGrass + wForest) + nR * (wRock + wCobble) + nD * wRoad + vec3(0.0, 0.0, 1.0) * (wSnow + 0.35));
  vec3 N = normalize(vWN);
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 Bt = normalize(vec3(0.0, 0.0, 1.0) - N * N.z);
  vec3 nW = normalize(T * nt.x + Bt * nt.y + N * nt.z);
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}`);
  };
  mat.customProgramCacheKey = () => 'terrain-splat-v1';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  // Glacial river: animated normals, environment reflections.
  const [a, b] = map.river;
  const len = Math.hypot(b.x - a.x, b.y - a.y) + 40;
  const wGeo = new THREE.PlaneGeometry(len, map.riverHalfWidth * 2 + 6, 1, 1);
  wGeo.rotateX(-Math.PI / 2);
  const waterN = makeWaterNormal();
  waterN.repeat.set(len / 8, 2);
  const water = new THREE.Mesh(wGeo, new THREE.MeshStandardMaterial({ color: 0x24434c, roughness: 0.06, metalness: 0.2, normalMap: waterN, normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.86, envMapIntensity: 1.4 }));
  water.position.set(0, WATER_LEVEL, 0);
  water.rotation.y = Math.atan2(b.y - a.y, b.x - a.x);
  water.receiveShadow = true;

  return {
    mesh, water,
    heightAt: (x, y) => terrainHeight(map, x, y),
    update(time: number) { waterN.offset.set(time * 0.05, time * 0.013); },
  };
}

/** Tileable procedural ripple normal map (sum of sine waves) — no external asset needed. */
function makeWaterNormal(): THREE.DataTexture {
  const S = 256, data = new Uint8Array(S * S * 4);
  const waves = Array.from({ length: 8 }, (_, i) => ({ kx: Math.round(Math.cos(i * 2.4) * (2 + i)), ky: Math.round(Math.sin(i * 2.4) * (2 + i)), a: 1 / (1 + i * 0.6), p: i * 1.7 }));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let dx = 0, dy = 0;
    for (const w of waves) { const ph = ((w.kx * x + w.ky * y) / S) * Math.PI * 2 + w.p; const c = Math.cos(ph) * w.a; dx += c * w.kx; dy += c * w.ky; }
    const n = new THREE.Vector3(-dx * 0.04, -dy * 0.04, 1).normalize();
    const k = (y * S + x) * 4;
    data[k] = (n.x * 0.5 + 0.5) * 255; data[k + 1] = (n.y * 0.5 + 0.5) * 255; data[k + 2] = (n.z * 0.5 + 0.5) * 255; data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
  return t;
}
