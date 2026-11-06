import { DT } from './constants.js';
import { type MapDef, type Team, type LaneId, createMap } from './map.js';
import { NavGrid } from './nav.js';
import { type Vec2, dist, clamp } from './math.js';
import type { Command, EntitySnapshot, Snapshot } from './protocol.js';

export type EntityKind = 'hero' | 'minion';

export interface Entity {
  id: number;
  kind: EntityKind;
  team: Team;
  pos: Vec2;
  facing: number; // radians, world-space atan2(dy, dx)
  radius: number;
  speed: number;
  hp: number;
  maxHp: number;
  path: Vec2[];
  moving: boolean;
  lane?: LaneId;
  laneIdx?: number;
  owner?: string; // player id for heroes
  heroId?: string;
}

export interface WorldOptions { seed?: number; minionWaves?: boolean; waveInterval?: number }

/**
 * Authoritative, deterministic simulation. Pure TypeScript, no I/O:
 * runs identically inside the Node server, a browser Worker, or tests.
 */
export class World {
  readonly map: MapDef;
  readonly nav: NavGrid;
  tick = 0;
  private nextId = 1;
  readonly entities = new Map<number, Entity>();
  private pending: { playerId: string; cmd: Command }[] = [];
  private readonly opts: Required<WorldOptions>;

  constructor(opts: WorldOptions = {}) {
    this.opts = { seed: 1337, minionWaves: true, waveInterval: 30, ...opts };
    this.map = createMap(this.opts.seed);
    this.nav = new NavGrid(this.map);
  }

  spawnHero(owner: string, team: Team, heroId = 'graybox'): Entity {
    const base = this.map.bases[team].pos;
    const n = [...this.entities.values()].filter((e) => e.kind === 'hero' && e.team === team).length;
    const ang = (n / 5) * Math.PI * 2;
    const pos = this.nav.nearestWalkable({ x: base.x + Math.cos(ang) * 4, y: base.y + Math.sin(ang) * 4 }) ?? base;
    return this.add({ kind: 'hero', team, pos: { ...pos }, facing: team === 0 ? Math.PI / 4 : -3 * Math.PI / 4, radius: 0.7, speed: 6.2, hp: 620, maxHp: 620, path: [], moving: false, owner, heroId });
  }

  removeOwner(owner: string): void {
    for (const [id, e] of this.entities) if (e.owner === owner) this.entities.delete(id);
  }

  queue(playerId: string, cmd: Command): void { this.pending.push({ playerId, cmd }); }

  step(): void {
    this.applyCommands();
    if (this.opts.minionWaves) this.spawnWaves();
    for (const e of this.entities.values()) {
      if (e.kind === 'minion') this.steerMinion(e);
      this.integrate(e);
    }
    this.separate();
    this.tick++;
  }

  snapshot(): Snapshot {
    const ents: EntitySnapshot[] = [];
    for (const e of this.entities.values()) {
      ents.push({ id: e.id, k: e.kind === 'hero' ? 0 : 1, t: e.team, x: round2(e.pos.x), y: round2(e.pos.y), f: round2(e.facing), hp: Math.round(e.hp), mh: e.maxHp, m: e.moving ? 1 : 0, o: e.owner, h: e.heroId });
    }
    return { tick: this.tick, ents };
  }

  /** Cheap state hash for determinism tests and desync detection. */
  hash(): number {
    let h = 2166136261 >>> 0;
    const mix = (v: number) => { h ^= Math.round(v * 1000) | 0; h = Math.imul(h, 16777619) >>> 0; };
    mix(this.tick);
    for (const e of [...this.entities.values()].sort((a, b) => a.id - b.id)) { mix(e.id); mix(e.pos.x); mix(e.pos.y); mix(e.hp); }
    return h;
  }

  // --- internals -------------------------------------------------------------

  private add(e: Omit<Entity, 'id'>): Entity {
    const ent: Entity = { ...e, id: this.nextId++ };
    this.entities.set(ent.id, ent);
    return ent;
  }

  private heroOf(playerId: string): Entity | undefined {
    for (const e of this.entities.values()) if (e.owner === playerId) return e;
    return undefined;
  }

  private applyCommands(): void {
    const cmds = this.pending; this.pending = [];
    for (const { playerId, cmd } of cmds) {
      const hero = this.heroOf(playerId);
      if (!hero) continue;
      switch (cmd.type) {
        case 'move': {
          const tx = clamp(cmd.x, -this.map.half, this.map.half), ty = clamp(cmd.y, -this.map.half, this.map.half);
          const path = this.nav.findPath(hero.pos, { x: tx, y: ty });
          hero.path = path ?? [];
          hero.moving = hero.path.length > 0;
          break;
        }
        case 'stop': hero.path = []; hero.moving = false; break;
      }
    }
  }

  private spawnWaves(): void {
    const every = Math.round(this.opts.waveInterval / DT);
    const first = Math.round(5 / DT);
    if (this.tick < first || (this.tick - first) % every !== 0) return;
    for (const team of [0, 1] as const) for (const lane of ['top', 'mid', 'bot'] as const) {
      const pts = this.lanePoints(lane, team);
      for (let i = 0; i < 4; i++) {
        const start = pts[0]!;
        const back = { x: start.x - Math.sign(pts[1]!.x - start.x) * i * 1.4, y: start.y - Math.sign(pts[1]!.y - start.y) * i * 1.4 };
        this.add({ kind: 'minion', team, pos: this.nav.nearestWalkable(back) ?? { ...start }, facing: 0, radius: 0.45, speed: 3.6, hp: 280, maxHp: 280, path: [], moving: true, lane, laneIdx: 1 });
      }
    }
  }

  private lanePoints(lane: LaneId, team: Team): Vec2[] {
    const pts = this.map.lanes[lane];
    return team === 0 ? pts : [...pts].reverse();
  }

  private steerMinion(e: Entity): void {
    const pts = this.lanePoints(e.lane!, e.team);
    if (e.path.length === 0) {
      if (e.laneIdx! >= pts.length) {
        // Reached the enemy base: despawn for now (combat lands with the core-gameplay milestone).
        this.entities.delete(e.id);
        return;
      }
      e.path = [pts[e.laneIdx!]!];
      e.laneIdx!++;
    }
  }

  private integrate(e: Entity): void {
    let budget = e.speed * DT;
    while (budget > 0 && e.path.length) {
      const wp = e.path[0]!;
      const d = dist(e.pos, wp);
      if (d < 1e-4) { e.path.shift(); continue; }
      e.facing = Math.atan2(wp.y - e.pos.y, wp.x - e.pos.x);
      if (d <= budget) { e.pos = { ...wp }; budget -= d; e.path.shift(); }
      else { e.pos = { x: e.pos.x + ((wp.x - e.pos.x) / d) * budget, y: e.pos.y + ((wp.y - e.pos.y) / d) * budget }; budget = 0; }
    }
    e.moving = e.path.length > 0;
  }

  /** Soft unit separation; resolved positions are kept on walkable ground. */
  private separate(): void {
    const list = [...this.entities.values()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!, b = list[j]!;
      const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
      const min = a.radius + b.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 < 1e-8) continue;
      const d = Math.sqrt(d2), push = (min - d) * 0.5;
      const nx = dx / d, ny = dy / d;
      const na = { x: a.pos.x - nx * push, y: a.pos.y - ny * push };
      const nb = { x: b.pos.x + nx * push, y: b.pos.y + ny * push };
      if (this.nav.isWalkable(na)) a.pos = na;
      if (this.nav.isWalkable(nb)) b.pos = nb;
    }
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;
