import type { MapDef } from './map.js';
import { distToPolyline, distToSegment } from './math.js';

/** Deterministic value noise (integer hash, no Math.random) — identical on server and client. */
function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function valueNoise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number, octaves = 4, seed = 0): number {
  let s = 0, a = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) { s += a * valueNoise(x * f, y * f, seed + i * 17); norm += a; a *= 0.5; f *= 2.03; }
  return s / norm;
}
const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export interface TerrainMasks { lane: number; river: number; base: number; edge: number }

/** 0..1 masks describing what a point is (used for height shaping and client texture splatting). */
export function terrainMasks(map: MapDef, x: number, y: number): TerrainMasks {
  const p = { x, y };
  let laneD = Infinity;
  for (const l of Object.values(map.lanes)) laneD = Math.min(laneD, distToPolyline(p, l));
  const riverD = distToSegment(p, map.river[0], map.river[1]);
  let base = 0;
  for (const t of [0, 1] as const) {
    const b = map.bases[t];
    base = Math.max(base, 1 - smooth(b.radius - 2, b.radius + 2, Math.hypot(x - b.pos.x, y - b.pos.y)));
  }
  return {
    lane: 1 - smooth(map.laneHalfWidth - 1.5, map.laneHalfWidth + 1.0, laneD),
    river: 1 - smooth(map.riverHalfWidth - 2.5, map.riverHalfWidth + 1.5, riverD),
    base,
    edge: smooth(map.half - 7, map.half + 6, Math.max(Math.abs(x), Math.abs(y))),
  };
}

export const WATER_LEVEL = -1.1;

/**
 * Ground height in metres. The playable valley is gently rolling, roads are smoothed, the glacial river is carved,
 * forts sit on plateaus and the valley walls rise into the surrounding mountains (backdrop only, not walkable).
 */
export function terrainHeight(map: MapDef, x: number, y: number): number {
  const m = terrainMasks(map, x, y);
  const rolling = (fbm(x * 0.035, y * 0.035, 4, map.seed) - 0.5) * 4.2 + (fbm(x * 0.12, y * 0.12, 2, map.seed + 7) - 0.5) * 0.8;
  const roadFlat = (fbm(x * 0.035, y * 0.035, 2, map.seed) - 0.5) * 2.2; // roads follow the broad shape only
  let h = rolling * (1 - m.lane) + roadFlat * m.lane;
  h = h * (1 - m.river) + (WATER_LEVEL - 0.55) * m.river;
  h = h * (1 - m.base) + 0.6 * m.base;
  // Valley walls -> mountains.
  const r = Math.max(Math.abs(x), Math.abs(y));
  if (m.edge > 0) {
    const ridge = 1 - Math.abs(fbm(x * 0.012, y * 0.012, 5, map.seed + 99) * 2 - 1);
    const mount = smooth(map.half - 4, map.half + 140, r);
    h += m.edge * 7 + mount * (40 + ridge * ridge * 150) + (fbm(x * 0.05, y * 0.05, 3, map.seed + 5) - 0.5) * 12 * mount;
  }
  return h;
}
