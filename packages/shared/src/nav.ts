import type { MapDef } from './map.js';
import type { Vec2 } from './math.js';

/** Uniform walkability grid baked from the MapDef. Cell size 1 world unit. */
export class NavGrid {
  readonly size: number;
  readonly origin: number;
  readonly walk: Uint8Array;
  /** Runtime blockers (player-built structures), reference-counted per cell. */
  readonly blocked: Uint8Array;

  constructor(map: MapDef, readonly cell = 1, clearance = 0.6) {
    this.size = Math.ceil((map.half * 2) / cell);
    this.origin = -map.half;
    this.walk = new Uint8Array(this.size * this.size);
    this.blocked = new Uint8Array(this.size * this.size);
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
  isWalkableCell(gx: number, gy: number): boolean { const i = gy * this.size + gx; return this.inBounds(gx, gy) && this.walk[i] === 1 && this.blocked[i] === 0; }
  /** Static terrain walkability only (ignores player structures). */
  isStaticWalkable(p: Vec2): boolean { const [x, y] = this.toCell(p); return this.inBounds(x, y) && this.walk[y * this.size + x] === 1; }

  /** Cells covered by a 2 m x 2 m structure centred on a 2 m grid point. */
  footprint(x: number, y: number): number[] {
    const out: number[] = [];
    const [cx, cy] = this.toCell({ x: x - 1 + 0.01, y: y - 1 + 0.01 });
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (this.inBounds(cx + dx, cy + dy)) out.push((cy + dy) * this.size + cx + dx);
    return out;
  }
  block(cells: number[], on: boolean) { for (const c of cells) this.blocked[c] = Math.max(0, this.blocked[c]! + (on ? 1 : -1)); }

  /**
   * Weighted Dijkstra distance field toward `goals` (cell indices). Cells where `cost(i)` is larger are avoided
   * (used to keep minions in their lane corridor). Infinity = unreachable.
   */
  flowField(goals: number[], cost: Uint8Array): Float32Array {
    const n = this.size, N = n * n, dist = new Float32Array(N).fill(Infinity);
    // Passability snapshot (static walk && no structure) — avoids per-neighbour bounds/method calls.
    const pass = new Uint8Array(N);
    for (let i = 0; i < N; i++) pass[i] = this.walk[i]! & (this.blocked[i] === 0 ? 1 : 0);
    // Preallocated typed binary heap (lazy deletion). Hot loop is allocation-free.
    const cap = N * 4;
    const hk = new Float32Array(cap), hv = new Int32Array(cap);
    let size = 0;
    const push = (v: number, k: number) => {
      if (size >= cap) return; // cannot happen in practice (each cell improves a bounded number of times)
      let i = size++;
      while (i > 0) { const p = (i - 1) >> 1; if (hk[p]! <= k) break; hk[i] = hk[p]!; hv[i] = hv[p]!; i = p; }
      hk[i] = k; hv[i] = v;
    };
    for (const g of goals) { dist[g] = 0; push(g, 0); }
    const D = Math.SQRT2;
    while (size > 0) {
      const key = hk[0]!, cur = hv[0]!;
      // pop
      const lk = hk[--size]!, lv = hv[size]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i, mk = lk;
        if (l < size && hk[l]! < mk) { m = l; mk = hk[l]!; }
        if (r < size && hk[r]! < mk) m = r;
        if (m === i) break;
        hk[i] = hk[m]!; hv[i] = hv[m]!; i = m;
      }
      if (size > 0) { hk[i] = lk; hv[i] = lv; }
      const cd = dist[cur]!;
      if (key > cd + 1e-4) continue; // stale
      const cx = cur % n;
      const pl = cx > 0 && pass[cur - 1] === 1, pr = cx < n - 1 && pass[cur + 1] === 1;
      const pu = cur >= n && pass[cur - n] === 1, pd = cur < N - n && pass[cur + n] === 1;
      let ni: number, nd: number;
      if (pl) { ni = cur - 1; nd = cd + cost[ni]!; if (nd < dist[ni]!) { dist[ni] = nd; push(ni, nd); } }
      if (pr) { ni = cur + 1; nd = cd + cost[ni]!; if (nd < dist[ni]!) { dist[ni] = nd; push(ni, nd); } }
      if (pu) { ni = cur - n; nd = cd + cost[ni]!; if (nd < dist[ni]!) { dist[ni] = nd; push(ni, nd); } }
      if (pd) { ni = cur + n; nd = cd + cost[ni]!; if (nd < dist[ni]!) { dist[ni] = nd; push(ni, nd); } }
      // Diagonals only when both adjacent orthogonals are open (no corner cutting).
      if (pl && pu && pass[cur - n - 1] === 1) { ni = cur - n - 1; nd = cd + D * cost[ni]!; if (nd < dist[ni]!) { dist[ni] = nd; push(ni, nd); } }
      if (pr && pu && pass[cur - n + 1] === 1) { ni = cur - n + 1; nd = cd + D * cost[ni]!; if (nd < dist[ni]!) { dist[ni] = nd; push(ni, nd); } }
      if (pl && pd && pass[cur + n - 1] === 1) { ni = cur + n - 1; nd = cd + D * cost[ni]!; if (nd < dist[ni]!) { dist[ni] = nd; push(ni, nd); } }
      if (pr && pd && pass[cur + n + 1] === 1) { ni = cur + n + 1; nd = cd + D * cost[ni]!; if (nd < dist[ni]!) { dist[ni] = nd; push(ni, nd); } }
    }
    return dist;
  }

  /** Unweighted reachability: can `from` reach any goal cell? (used to forbid fully blocking a lane) */
  reachable(from: Vec2, goals: Set<number>): boolean {
    const n = this.size;
    const start = this.nearestWalkable(from, 4);
    if (!start) return false;
    const [sx, sy] = this.toCell(start);
    const N = n * n, seen = new Uint8Array(N), q = new Int32Array(N);
    let head = 0, tail = 0;
    q[tail++] = sy * n + sx; seen[sy * n + sx] = 1;
    while (head < tail) {
      const cur = q[head++]!;
      if (goals.has(cur)) return true;
      const cx = cur % n;
      const nb = [cx > 0 ? cur - 1 : -1, cx < n - 1 ? cur + 1 : -1, cur >= n ? cur - n : -1, cur < N - n ? cur + n : -1];
      for (const ni of nb) if (ni >= 0 && !seen[ni] && this.walk[ni] === 1 && this.blocked[ni] === 0) { seen[ni] = 1; q[tail++] = ni; }
    }
    return false;
  }
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
  peekKey(): number { return this.keys[0]!; }
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
