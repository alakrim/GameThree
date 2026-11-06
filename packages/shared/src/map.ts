import { Rng } from './rng.js';
import { type Vec2, distToPolyline, dist, distToSegment } from './math.js';

export type Team = 0 | 1; // 0 = Dawn (amber), 1 = Dusk (teal)
export type LaneId = 'top' | 'mid' | 'bot';

export interface Obstacle { kind: 'grove' | 'rock'; x: number; y: number; r: number; variant: number }

export interface MapDef {
  seed: number;
  half: number; // map spans [-half, half] on both axes
  lanes: Record<LaneId, Vec2[]>; // polylines from Dawn base to Dusk base
  laneHalfWidth: number;
  river: [Vec2, Vec2];
  riverHalfWidth: number;
  bases: Record<Team, { pos: Vec2; radius: number }>;
  obstacles: Obstacle[];
}

/**
 * "The Shoals of Aurel" — point-symmetric 3-lane island.
 * Obstacles are generated from a seed and mirrored through the origin so both teams get identical terrain.
 */
export function createMap(seed = 1337): MapDef {
  const half = 80;
  const lanes: Record<LaneId, Vec2[]> = {
    top: [{ x: -62, y: -54 }, { x: -66, y: 52 }, { x: -52, y: 66 }, { x: 54, y: 62 }],
    mid: [{ x: -56, y: -56 }, { x: 56, y: 56 }],
    bot: [{ x: -54, y: -62 }, { x: 52, y: -66 }, { x: 66, y: -52 }, { x: 62, y: 54 }],
  };
  const map: MapDef = {
    seed, half, lanes, laneHalfWidth: 5,
    river: [{ x: -80, y: 80 }, { x: 80, y: -80 }], riverHalfWidth: 6,
    bases: { 0: { pos: { x: -64, y: -64 }, radius: 14 }, 1: { pos: { x: 64, y: 64 }, radius: 14 } },
    obstacles: [],
  };

  const rng = new Rng(seed);
  const placed: Obstacle[] = [];
  const clearOf = (p: Vec2, r: number): boolean => {
    if (Math.abs(p.x) + r > half - 3 || Math.abs(p.y) + r > half - 3) return false;
    for (const id of ['top', 'mid', 'bot'] as const) if (distToPolyline(p, lanes[id]) < map.laneHalfWidth + r + 1.5) return false;
    if (distToSegment(p, map.river[0], map.river[1]) < map.riverHalfWidth + r + 1) return false;
    for (const t of [0, 1] as const) if (dist(p, map.bases[t].pos) < map.bases[t].radius + r + 4) return false;
    // Keep jungle corridors open: generous spacing between obstacles (min gap ~3.5 units).
    for (const o of placed) if (dist(p, o) < o.r + r + 3.5) return false;
    return true;
  };
  for (let i = 0; i < 2400 && placed.length < 120; i++) {
    const r = rng.range(2.2, 5.5);
    const p = { x: rng.range(-half, half), y: rng.range(-half, half) };
    const mirror = { x: -p.x, y: -p.y };
    if (!clearOf(p, r)) continue;
    const a: Obstacle = { kind: rng.next() < 0.65 ? 'grove' : 'rock', x: p.x, y: p.y, r, variant: rng.int(0, 4) };
    placed.push(a);
    if (!clearOf(mirror, r)) { placed.pop(); continue; }
    placed.push({ ...a, x: mirror.x, y: mirror.y });
  }
  map.obstacles = placed;
  return map;
}
