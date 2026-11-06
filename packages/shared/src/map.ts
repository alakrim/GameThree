import { Rng } from './rng.js';
import { type Vec2, distToPolyline, dist, distToSegment } from './math.js';

export type Team = 0 | 1; // 0 = Dawn (amber), 1 = Dusk (teal)
export type LaneId = 'top' | 'mid' | 'bot';

export interface Obstacle { kind: 'grove' | 'rock' | 'wall' | 'heart' | 'tower'; x: number; y: number; r: number; variant: number }

/** Fort ring wall radius (m) and gate half-width (m) where lanes leave the fort. */
export const FORT_WALL_R = 12.5;
export const FORT_GATE_HALF = 4.6;

export interface MapDef {
  seed: number;
  half: number; // map spans [-half, half] on both axes
  lanes: Record<LaneId, Vec2[]>; // polylines from Dawn base to Dusk base
  laneHalfWidth: number;
  river: [Vec2, Vec2];
  riverHalfWidth: number;
  bases: Record<Team, { pos: Vec2; radius: number }>;
  obstacles: Obstacle[];
  towers: TowerDef[];
}

export interface TowerDef { team: Team; lane: LaneId; tier: 1 | 2; x: number; y: number }

/** Point at fraction t of a polyline's arc length, plus the unit direction there. */
export function alongPolyline(pts: readonly Vec2[], t: number): { p: Vec2; dir: Vec2 } {
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = dist(pts[i]!, pts[i + 1]!); segs.push(l); total += l; }
  let d = t * total;
  for (let i = 0; i < segs.length; i++) {
    const l = segs[i]!;
    if (d <= l || i === segs.length - 1) {
      const a = pts[i]!, b = pts[i + 1]!, k = Math.min(1, d / l);
      return { p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, dir: { x: (b.x - a.x) / l, y: (b.y - a.y) / l } };
    }
    d -= l;
  }
  return { p: pts[0]!, dir: { x: 1, y: 0 } };
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
    towers: [],
  };
  // Two towers per lane per team (inner tier 2 near the fort, outer tier 1 further out), beside the road's left
  // edge; Dusk's are exact point mirrors of Dawn's.
  for (const lane of ['top', 'mid', 'bot'] as const) {
    for (const [tier, t] of [[2, 0.2], [1, 0.38]] as const) {
      const { p, dir } = alongPolyline(lanes[lane], t);
      const off = map.laneHalfWidth + 0.6; // just off the road edge: lanes stay fully open
      const x = p.x - dir.y * off, y = p.y + dir.x * off;
      map.towers.push({ team: 0, lane, tier, x, y }, { team: 1, lane: lane === 'top' ? 'bot' : lane === 'bot' ? 'top' : 'mid', tier, x: -x, y: -y });
    }
  }

  const rng = new Rng(seed);
  const placed: Obstacle[] = [...fortObstacles(map), ...map.towers.map((t, i) => ({ kind: 'tower' as const, x: t.x, y: t.y, r: 1.5, variant: i }))];
  const clearOf = (p: Vec2, r: number): boolean => {
    if (Math.abs(p.x) + r > half - 3 || Math.abs(p.y) + r > half - 3) return false;
    for (const id of ['top', 'mid', 'bot'] as const) if (distToPolyline(p, lanes[id]) < map.laneHalfWidth + r + 1.5) return false;
    if (distToSegment(p, map.river[0], map.river[1]) < map.riverHalfWidth + r + 1) return false;
    for (const t of [0, 1] as const) if (dist(p, map.bases[t].pos) < map.bases[t].radius + r + 4) return false;
    // Keep jungle corridors open: generous spacing between obstacles (min gap ~3.5 units).
    for (const o of placed) if (o.kind !== 'wall' && o.kind !== 'heart' && dist(p, o) < o.r + r + (o.kind === 'tower' ? 6 : 3.5)) return false;
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

/** Where each lane polyline first crosses the fort wall circle (Dawn fort), as an angle around the fort centre. */
export function gateAngles(map: MapDef): number[] {
  const c = map.bases[0].pos;
  const out: number[] = [];
  for (const lane of Object.values(map.lanes)) {
    let prev = lane[0]!;
    outer: for (let i = 1; i < lane.length; i++) {
      const a = lane[i - 1]!, b = lane[i]!;
      for (let t = 0; t <= 1; t += 0.01) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (Math.hypot(p.x - c.x, p.y - c.y) >= FORT_WALL_R) { out.push(Math.atan2(p.y - c.y, p.x - c.x)); break outer; }
        prev = p;
      }
    }
    void prev;
  }
  return out;
}

/** Fort ring walls (chain of circles with gates at lane exits) + Heartstone, mirrored exactly for Dusk. */
function fortObstacles(map: MapDef): Obstacle[] {
  const c = map.bases[0].pos;
  const gates = gateAngles(map);
  const gateHalfAng = FORT_GATE_HALF / FORT_WALL_R;
  const out: Obstacle[] = [{ kind: 'heart', x: c.x, y: c.y, r: 1.6, variant: 0 }];
  const steps = Math.round((Math.PI * 2 * FORT_WALL_R) / 1.4);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    if (gates.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < gateHalfAng)) continue;
    out.push({ kind: 'wall', x: c.x + Math.cos(a) * FORT_WALL_R, y: c.y + Math.sin(a) * FORT_WALL_R, r: 0.9, variant: i });
  }
  return [...out, ...out.map((o) => ({ ...o, x: -o.x, y: -o.y }))];
}
