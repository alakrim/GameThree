import type { MapDef } from './map.js';
import type { Vec2 } from './math.js';

/** Uniform walkability grid baked from the MapDef. Cell size 1 world unit. */
export class NavGrid {
  readonly size: number;
  readonly origin: number;
  readonly walk: Uint8Array;

  constructor(map: MapDef, readonly cell = 1, clearance = 0.6) {
    this.size = Math.ceil((map.half * 2) / cell);
    this.origin = -map.half;
    this.walk = new Uint8Array(this.size * this.size);
    for (let gy = 0; gy < this.size; gy++) {
      for (let gx = 0; gx < this.size; gx++) {
        const p = this.toWorld(gx, gy);
        let ok = Math.abs(p.x) < map.half - 1 && Math.abs(p.y) < map.half - 1;
        if (ok) for (const o of map.obstacles) {
          const dx = p.x - o.x, dy = p.y - o.y;
          const rr = o.r + clearance;
          if (dx * dx + dy * dy < rr * rr) { ok = false; break; }
        }
        this.walk[gy * this.size + gx] = ok ? 1 : 0;
      }
    }
  }

  toWorld(gx: number, gy: number): Vec2 { return { x: this.origin + (gx + 0.5) * this.cell, y: this.origin + (gy + 0.5) * this.cell }; }
  toCell(p: Vec2): [number, number] { return [Math.floor((p.x - this.origin) / this.cell), Math.floor((p.y - this.origin) / this.cell)]; }
  inBounds(gx: number, gy: number): boolean { return gx >= 0 && gy >= 0 && gx < this.size && gy < this.size; }
  isWalkableCell(gx: number, gy: number): boolean { return this.inBounds(gx, gy) && this.walk[gy * this.size + gx] === 1; }
  isWalkable(p: Vec2): boolean { const [x, y] = this.toCell(p); return this.isWalkableCell(x, y); }

  /** Supercover-ish line test via sampling at quarter-cell steps. */
  lineOfSight(a: Vec2, b: Vec2): boolean {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.ceil(d / (this.cell * 0.25));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.isWalkable({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
    }
    return true;
  }

  /** Nearest walkable cell centre to p (spiral search), or null. */
  nearestWalkable(p: Vec2, maxRadius = 12): Vec2 | null {
    const [cx, cy] = this.toCell(p);
    if (this.isWalkableCell(cx, cy)) return p;
    for (let r = 1; r <= maxRadius; r++) {
      let best: Vec2 | null = null, bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !this.isWalkableCell(cx + dx, cy + dy)) continue;
        const w = this.toWorld(cx + dx, cy + dy);
        const d = (w.x - p.x) ** 2 + (w.y - p.y) ** 2;
        if (d < bestD) { bestD = d; best = w; }
      }
      if (best) return best;
    }
    return null;
  }

  /** A* (8-connected, octile heuristic, no corner cutting) + line-of-sight string pulling. */
  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    const goal = this.nearestWalkable(to);
    const start = this.nearestWalkable(from);
    if (!goal || !start) return null;
    if (this.lineOfSight(from, goal)) return [goal];
    const n = this.size;
    const [sx, sy] = this.toCell(start);
    const [gx, gy] = this.toCell(goal);
    const g = new Float32Array(n * n).fill(Infinity);
    const parent = new Int32Array(n * n).fill(-1);
    const closed = new Uint8Array(n * n);
    const heap = new MinHeap();
    const h = (x: number, y: number) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy); };
    const s = sy * n + sx, goalIdx = gy * n + gx;
    g[s] = 0; heap.push(s, h(sx, sy));
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goalIdx) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % n, cy = (cur / n) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!this.isWalkableCell(nx, ny)) continue;
        if (dx && dy && (!this.isWalkableCell(cx + dx, cy) || !this.isWalkableCell(cx, cy + dy))) continue;
        const ni = ny * n + nx;
        const ng = g[cur]! + (dx && dy ? Math.SQRT2 : 1);
        if (ng < g[ni]!) { g[ni] = ng; parent[ni] = cur; heap.push(ni, ng + h(nx, ny)); }
      }
    }
    if (parent[goalIdx] === -1 && goalIdx !== s) return null;
    const cells: Vec2[] = [];
    for (let c = goalIdx; c !== -1; c = parent[c]!) cells.push(this.toWorld(c % n, (c / n) | 0));
    cells.reverse();
    cells[cells.length - 1] = goal;
    // String pulling: greedily skip to the farthest visible waypoint.
    const out: Vec2[] = [];
    let anchor = from, i = 0;
    while (i < cells.length) {
      let j = cells.length - 1;
      while (j > i && !this.lineOfSight(anchor, cells[j]!)) j--;
      out.push(cells[j]!);
      anchor = cells[j]!;
      i = j + 1;
    }
    return out;
  }
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length; ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      ids[i] = ids[p]!; keys[i] = keys[p]!; i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0]!;
    const lastId = ids.pop()!, lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lastKey;
        if (l < n && keys[l]! < mk) { m = l; mk = keys[l]!; }
        if (r < n && keys[r]! < mk) { m = r; }
        if (m === i) break;
        ids[i] = ids[m]!; keys[i] = keys[m]!; i = m;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
}
