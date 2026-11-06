import type { World, Entity } from './world.js';
import type { LaneId } from './map.js';
import { HEROES } from './heroes.js';
import { dist } from './math.js';

/**
 * Simple lane bot. Issues the same commands a player would (no cheating access to inputs):
 * follow the lane behind its own minions, fight what is in reach, use abilities, retreat to heal.
 */
export class BotBrain {
  private seq = 0;
  private retreating = false;
  private thinkEvery = 3; // ticks between decisions
  private phase: number;
  constructor(readonly id: string, readonly lane: LaneId) { this.phase = id.length % 3; }

  think(w: World): void {
    const me = w.heroOf(this.id);
    if (!me || me.deadTicks) return;
    const def = HEROES[me.heroId!]!;
    const fort = w.map.bases[me.team].pos;
    const hpFrac = me.hp / me.maxHp;
    if (hpFrac < 0.3) this.retreating = true;
    if (this.retreating && hpFrac > 0.95) this.retreating = false;

    if ((w.tick + this.phase) % this.thinkEvery === 0) {
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
          if (s === 3 && target.kind !== 'hero') continue;
          const reach = ab.kind === 'selfAoe' ? (ab.radius ?? 5) : (ab.range ?? 4);
          if (d <= reach) { w.queue(this.id, { type: 'act', slot: s, aim, tx: target.pos.x, ty: target.pos.y }); break; }
        }
        if (d <= def.attack.range + target.radius) w.queue(this.id, { type: 'act', slot: 0, aim });
        // Keep spacing: melee closes in, ranged holds ~70% of its range.
        const want = def.attack.kind === 'melee' ? 1.6 : def.attack.range * 0.7;
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

  private move(w: World, _me: Entity, mx: number, my: number) { w.queue(this.id, { type: 'input', seq: ++this.seq, mx, my }); }

  /** Stand a little behind the front-most allied minion in our lane, or at our outer tower if none. */
  private lanePosition(w: World, me: Entity): { x: number; y: number } {
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

  /** Don't dive: avoid targets inside an enemy tower's range unless allied minions are tanking it. */
  private underEnemyTower(w: World, me: Entity, target: Entity): boolean {
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
