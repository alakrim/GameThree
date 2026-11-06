import type { World, Entity } from './world.js';
import type { LaneId } from './map.js';
import { HEROES } from './heroes.js';
import { dist, distToPolyline } from './math.js';
import { BULWARKS, SENDS, investedIn, type BulwarkType } from './bulwarks.js';
import { World as WorldClass } from './world.js';
import { ITEMS, MAX_ITEMS, type ItemId } from './items.js';

/** Item build orders by role (bots buy the next affordable piece whenever they stand in their fort). */
const BUILDS: Record<string, ItemId[]> = {
  Warden: ['boots', 'mantle', 'fang', 'plate'],
  Vanguard: ['mantle', 'boots', 'plate', 'ram'],
  Marksman: ['edge', 'boots', 'fang', 'ram'],
  Runecaster: ['rune', 'boots', 'ember', 'mantle'],
  Mystic: ['rune', 'kit', 'boots', 'ember'],
};

/**
 * Simple lane bot. Issues the same commands a player would (no cheating access to inputs):
 * follow the lane behind its own minions, fight what is in reach, use abilities, retreat to heal.
 */
export class BotBrain {
  private seq = 0;
  private retreating = false;
  private thinkEvery = 3; // ticks between decisions
  private phase: number;
  private buildCycle = 0;
  private rng: number;
  /** `seed` (the match seed) varies each bot's decisions between matches; ids alone would replay the same choices forever. */
  constructor(readonly id: string, public lane: LaneId, seed = 0) {
    this.phase = id.length % 3;
    this.rng = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7 ^ Math.imul(seed + 1, 2654435761)) >>> 0;
  }

  /** Deterministic per-bot PRNG (simulation must stay reproducible). */
  private rand(): number { this.rng = (Math.imul(this.rng ^ (this.rng >>> 15), 2246822519) + 0x9e3779b9) >>> 0; return this.rng / 4294967296; }

  think(w: World): void {
    const me = w.heroOf(this.id);
    if (!me) return;
    if (me.deadTicks) { if ((w.tick + this.phase * 11) % 30 === 0) this.shop(w, me); return; }
    const def = HEROES[me.heroId!]!;
    const fort = w.map.bases[me.team].pos;
    const hpFrac = me.hp / me.maxHp;
    if (hpFrac < 0.3) this.retreating = true;
    if (this.retreating && hpFrac > 0.95) this.retreating = false;

    if ((w.tick + this.phase * 17) % 45 === 0 && !this.retreating) this.economy(w, me);
    if ((w.tick + this.phase * 11) % 30 === 0) this.shop(w, me);
    if (me.recall !== undefined && !this.enemyNear(w, me, 8)) { this.move(w, me, 0, 0); return; } // hold still while channelling
    if ((w.tick + this.phase) % this.thinkEvery === 0) {
      if (this.wantsRecall(w, me)) { w.queue(this.id, { type: 'recall' }); this.move(w, me, 0, 0); return; }
      if (this.support(w, me)) return;
      if (me.repair !== undefined && !this.enemyNear(w, me, 9)) { this.move(w, me, 0, 0); return; }
      // Pick the closest attackable enemy in engagement range.
      let target: Entity | undefined, best = 14;
      for (const e of w.entities.values()) {
        if (e.team === me.team || e.kind === 'projectile' || e.deadTicks || e.hp <= 0 || e.invulnerable) continue;
        const d = dist(e.pos, me.pos) - (e.kind === 'hero' ? 2 : 0);
        if (d < best && !this.underEnemyTower(w, me, e)) { best = d; target = e; }
      }
      if (!this.retreating && target) {
        const aim = Math.atan2(target.pos.y - me.pos.y, target.pos.x - me.pos.x);
        const d = dist(target.pos, me.pos);
        // Abilities first (target heroes with the strong stuff), then basic attacks.
        const abs = def.abilities;
        for (let s = 3; s >= 1; s--) {
          const ab = abs[s - 1]!;
          if (me.cds![s]! > 0) continue;
          if (ab.kind === 'dash' && ab.damage === 0) continue; // mobility dash: kept for escapes
          if (ab.targets === 'ally' || (ab.kind === 'selfAoe' && !ab.damage)) continue; // support tools: see support()
          if ((s === 3 || ab.heroOnly || ab.kind === 'trap') && target.kind !== 'hero') continue;
          if (ab.pull && d < 3.5) continue; // hooks are for catching, not point-blank
          const reach = ab.kind === 'selfAoe' ? (ab.radius ?? 5) : (ab.range ?? 4);
          if (d <= reach * 0.92) { w.queue(this.id, { type: 'act', slot: s, aim, tx: target.pos.x, ty: target.pos.y }); break; }
        }
        if (d <= def.attack.range + target.radius) w.queue(this.id, { type: 'act', slot: 0, aim });
        // Keep spacing: melee closes to ~60% of its reach (long chains hang back), ranged holds ~70% of its range.
        const want = def.attack.kind === 'melee' ? Math.max(1.6, def.attack.range * 0.6) : def.attack.range * 0.7;
        const dir = d > want ? 1 : d < want * 0.6 ? -1 : 0;
        this.move(w, me, dir * (target.pos.x - me.pos.x) / d, dir * (target.pos.y - me.pos.y) / d);
        return;
      }
      const goal = this.retreating ? fort : this.lanePosition(w, me);
      const d = dist(goal, me.pos);
      if (this.retreating && me.cds![2]! === 0 && def.abilities[1]!.kind === 'dash' && def.abilities[1]!.damage === 0 && d > 10) {
        w.queue(this.id, { type: 'act', slot: 2, aim: Math.atan2(goal.y - me.pos.y, goal.x - me.pos.x) });
      }
      if (d < 1.5) { this.move(w, me, 0, 0); return; }
      const path = w.nav.findPath(me.pos, goal);
      const wp = path?.[0] ?? goal;
      const l = Math.max(1e-6, dist(wp, me.pos));
      this.move(w, me, (wp.x - me.pos.x) / l, (wp.y - me.pos.y) / l);
    } else {
      // Between decisions keep feeding the same input so the server doesn't stall us.
      this.move(w, me, me.input?.mx ?? 0, me.input?.my ?? 0);
    }
  }

  /** Items this bot should own by now: one every ~3 minutes. */
  private itemTarget(w: World): number { return Math.min(MAX_ITEMS, Math.floor((w.tick / 30 / 60 + 1) / 3)); }
  private nextItem(me: Entity): ItemId | undefined { return (BUILDS[HEROES[me.heroId!]!.role] ?? BUILDS.Warden!).find((i) => !me.items!.includes(i)); }
  /** Saving for gear: bulwark spending must leave enough for the next item. */
  private reserve(w: World, me: Entity): number {
    const want = this.nextItem(me);
    return want && (me.items?.length ?? 0) < this.itemTarget(w) ? ITEMS[want].cost : 0;
  }
  private wantsRecall(w: World, me: Entity): boolean {
    if (me.recall !== undefined || dist(me.pos, w.map.bases[me.team].pos) < 30 || this.enemyNear(w, me, 12)) return false;
    const want = this.nextItem(me), gold = me.gold ?? 0;
    const shopping = !!want && (me.items?.length ?? 0) < this.itemTarget(w) && gold >= ITEMS[want].cost;
    return shopping || (this.retreating && me.hp / me.maxHp < 0.3);
  }

  private enemyNear(w: World, me: Entity, r: number): boolean {
    for (const e of w.entities.values()) if (e.team !== me.team && (e.kind === 'hero' || e.kind === 'minion') && !e.deadTicks && e.hp > 0 && dist(e.pos, me.pos) < r) return true;
    return false;
  }

  /** Ally-targeted kit pieces (heals, shields, sustain rings). Returns true when it used the decision tick. */
  private support(w: World, me: Entity): boolean {
    const def = HEROES[me.heroId!]!;
    for (let s = 1; s <= 3; s++) {
      const ab = def.abilities[s - 1]!;
      if (me.cds![s]! > 0 || me.action) continue;
      const helps = !!(ab.heal || ab.shield || ab.allyHot);
      if (!helps) continue;
      const fighting = this.enemyNear(w, me, 14);
      if (ab.allyHot) {
        // Ring: when allies (or we) inside it are hurt and there is a fight.
        let hurt = 0;
        for (const a of w.entities.values()) if (a.kind === 'hero' && a.team === me.team && !a.deadTicks && dist(a.pos, me.pos) < (ab.radius ?? 8) && a.hp / a.maxHp < 0.55) hurt++;
        if (hurt >= 1 && fighting) { w.queue(this.id, { type: 'act', slot: s, aim: me.facing }); return true; }
        continue;
      }
      // Skillshot onto the most hurt ally hero in range (not ourselves).
      let best: Entity | undefined, bestF = ab.shield ? 0.7 : 0.8;
      for (const a of w.entities.values()) {
        if (a.kind !== 'hero' || a.team !== me.team || a === me || a.deadTicks) continue;
        const d = dist(a.pos, me.pos);
        if (d > (ab.range ?? 12) * 0.9 || d < 1.2) continue;
        const f = a.hp / a.maxHp;
        if (ab.shield && !fighting) continue;
        if (f < bestF) { bestF = f; best = a; }
      }
      if (best) { w.queue(this.id, { type: 'act', slot: s, aim: Math.atan2(best.pos.y - me.pos.y, best.pos.x - me.pos.x) }); return true; }
    }
    return false;
  }

  /** Buy the next item of the role's build when standing in the fort (or dead). */
  private shop(w: World, me: Entity): void {
    const inFort = !!me.deadTicks || dist(me.pos, w.map.bases[me.team].pos) < w.map.bases[me.team].radius;
    if (!inFort || (me.items?.length ?? 0) >= MAX_ITEMS) return;
    const want = this.nextItem(me);
    if (want && (me.gold ?? 0) >= ITEMS[want].cost) w.queue(this.id, { type: 'buy', item: want });
  }

  /** Tower-defence decisions: fortify beside our lane, upgrade, and send units with surplus gold. */
  private economy(w: World, me: Entity): void {
    const gold = (me.gold ?? 0) - this.reserve(w, me);
    const mine = [...w.entities.values()].filter((e) => e.kind === 'bulwark' && e.team === me.team);
    // Patch up a damaged structure close by when the coast is clear.
    if (gold > 80 && me.repair === undefined && !this.enemyNear(w, me, 10)) {
      const hurt = mine.filter((b) => b.bw!.type !== 'spikes' && b.hp / b.maxHp < 0.7 && dist(b.pos, me.pos) < 5.2)
        .sort((a, b) => investedIn(b.bw!.type, b.bw!.level) - investedIn(a.bw!.type, a.bw!.level))[0];
      if (hurt) { w.queue(this.id, { type: 'repair', id: hurt.id }); return; }
    }
    // Upgrade something close by when rich.
    if (gold > 220) {
      const up = mine.filter((b) => b.bw!.level < 3 && b.bw!.type !== 'palisade' && dist(b.pos, me.pos) < 8).sort((a, b) => a.bw!.level - b.bw!.level)[0];
      if (up && gold >= BULWARKS[up.bw!.type].levels[up.bw!.level]!.cost) { w.queue(this.id, { type: 'upgrade', id: up.id }); return; }
    }
    if (gold > 360 && this.rand() < 0.5) {
      const unit = gold > 500 ? 'brute' : 'wolves';
      const lanes: LaneId[] = ['top', 'mid', 'bot'];
      w.queue(this.id, { type: 'send', unit, lane: lanes[Math.floor(this.rand() * 3)]! });
      if (gold - SENDS[unit].cost < 120) return;
    }
    if (!w.canBuildMore(this.id, me.team)) return; // at the cap: gold goes to upgrades, sends and items
    const order: BulwarkType[] = ['arrow', 'frost', 'arrow', 'fire', 'spikes', 'arrow', 'fire'];
    const kind = order[this.buildCycle % order.length]!;
    if (gold < BULWARKS[kind].levels[0].cost + 20) return;
    const lanePts = w.map.lanes[this.lane];
    for (let tries = 0; tries < 12; tries++) {
      const a = this.rand() * Math.PI * 2, r = 4 + this.rand() * 8;
      const x = Math.round((me.pos.x + Math.cos(a) * r) / 2) * 2, y = Math.round((me.pos.y + Math.sin(a) * r) / 2) * 2;
      const dl = distToPolyline({ x, y }, lanePts);
      // Traps go on the road; everything else beside it (bots leave mazing to humans).
      const ok = kind === 'spikes' ? dl < w.map.laneHalfWidth - 1 : dl > w.map.laneHalfWidth + 1 && dl < w.map.laneHalfWidth + 6;
      if (!ok || WorldClass.siteProblem(w, me.team, x, y)) continue;
      if (mine.some((b) => dist(b.pos, { x, y }) < 4)) continue;
      w.queue(this.id, { type: 'build', kind, x, y });
      this.buildCycle++;
      return;
    }
  }

  private move(w: World, _me: Entity, mx: number, my: number) { w.queue(this.id, { type: 'input', seq: ++this.seq, mx, my }); }

  /**
   * Team push: from minute 12 — or as soon as an enemy gate tower falls — the bots of a team converge on the
   * enemy lane with the fewest standing towers and march on the Heartstone together.
   */
  private siegeLane(w: World, me: Entity): LaneId | null {
    const towers = { top: 0, mid: 0, bot: 0 } as Record<LaneId, number>;
    let gateDown = false;
    const gates = new Set<LaneId>();
    for (const e of w.entities.values()) if (e.kind === 'tower' && e.team !== me.team) { towers[e.lane!]++; if (e.tier === 2) gates.add(e.lane!); }
    for (const l of ['top', 'mid', 'bot'] as const) if (!gates.has(l)) gateDown = true;
    if (w.matchSeconds < 12 * 60 && !gateDown) return null;
    return (['mid', 'top', 'bot'] as const).reduce((a, b) => (towers[b] < towers[a] ? b : a));
  }

  private alliesNear(w: World, me: Entity, r: number): number {
    let n = 0;
    for (const e of w.entities.values()) if (e.kind === 'hero' && e.team === me.team && e !== me && !e.deadTicks && dist(e.pos, me.pos) < r) n++;
    return n;
  }

  /** Stand a little behind the front-most allied minion in our lane, or at our outer tower if none. */
  private lanePosition(w: World, me: Entity): { x: number; y: number } {
    const siege = this.siegeLane(w, me);
    if (siege) return this.siegePosition(w, me, siege);
    const pts = w.lanePoints(this.lane, me.team);
    const enemyFort = w.map.bases[me.team === 0 ? 1 : 0].pos;
    let front: Entity | undefined, bestD = Infinity;
    for (const e of w.entities.values()) {
      if (e.kind !== 'minion' || e.team !== me.team || e.lane !== this.lane) continue;
      const d = dist(e.pos, enemyFort);
      if (d < bestD) { bestD = d; front = e; }
    }
    if (front) {
      const back = Math.atan2(front.pos.y - enemyFort.y, front.pos.x - enemyFort.x);
      return { x: front.pos.x + Math.cos(back) * 3, y: front.pos.y + Math.sin(back) * 3 };
    }
    const tower = [...w.entities.values()].find((e) => e.kind === 'tower' && e.team === me.team && e.lane === this.lane && e.tier === 1)
      ?? [...w.entities.values()].find((e) => e.kind === 'tower' && e.team === me.team && e.lane === this.lane);
    return tower ? { x: tower.pos.x, y: tower.pos.y } : pts[0]!;
  }

  /** Siege: gather at the front of our wave in the push lane; with no wave, advance on the next enemy objective once grouped. */
  private siegePosition(w: World, me: Entity, lane: LaneId): { x: number; y: number } {
    const enemyFort = w.map.bases[me.team === 0 ? 1 : 0].pos;
    let front: Entity | undefined, bestD = Infinity;
    for (const e of w.entities.values()) {
      if (e.kind !== 'minion' || e.team !== me.team || e.lane !== lane) continue;
      const d = dist(e.pos, enemyFort);
      if (d < bestD) { bestD = d; front = e; }
    }
    if (front) return { x: front.pos.x, y: front.pos.y };
    // No wave: next enemy tower in the lane (or the Heartstone). Wait short of it until two allies have joined.
    const objective = [...w.entities.values()].filter((e) => e.kind === 'tower' && e.team !== me.team && e.lane === lane).sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0))[0]
      ?? [...w.entities.values()].find((e) => e.kind === 'heart' && e.team !== me.team);
    if (!objective) return enemyFort;
    const grouped = this.alliesNear(w, me, 12) >= 1;
    const back = Math.atan2(me.pos.y - objective.pos.y, me.pos.x - objective.pos.x);
    const stand = grouped ? 6 : 15;
    return w.nav.nearestWalkable({ x: objective.pos.x + Math.cos(back) * stand, y: objective.pos.y + Math.sin(back) * stand }) ?? objective.pos;
  }

  /** Don't dive: avoid targets inside an enemy tower's range unless allied minions are tanking it or the team dives together. */
  private underEnemyTower(w: World, me: Entity, target: Entity): boolean {
    if (this.alliesNear(w, me, 10) >= 2 && me.hp / me.maxHp > 0.5) return false;
    for (const t of w.entities.values()) {
      if (t.kind !== 'tower' || t.team === me.team) continue;
      if (dist(t.pos, target.pos) < 12.5 && target.kind !== 'tower') {
        const tanked = [...w.entities.values()].some((m) => m.kind === 'minion' && m.team === me.team && dist(m.pos, t.pos) < 11);
        if (!tanked) return true;
      }
      if (target === t) {
        const tanked = [...w.entities.values()].some((m) => m.kind === 'minion' && m.team === me.team && dist(m.pos, t.pos) < 11);
        if (!tanked) return true;
      }
    }
    return false;
  }
}
