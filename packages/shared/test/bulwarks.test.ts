import { describe, it, expect } from 'vitest';
import { World, BULWARKS, ECON, SENDS, UNITS, TICK_RATE, WAVES, type Entity } from '../src/index.js';

const steps = (w: World, n: number) => { for (let i = 0; i < n; i++) w.step(); };
const heroAt = (w: World, id: string, team: 0 | 1, x: number, y: number) => { const h = w.spawnHero(id, team, 'hrodvar'); h.pos = { x, y }; return h; };
const bulwarks = (w: World, team?: 0 | 1) => [...w.entities.values()].filter((e) => e.kind === 'bulwark' && (team === undefined || e.team === team));
const lastDeny = (w: World) => (w.snapshot().ev ?? []).filter((e) => e.e === 'deny').map((e) => (e as { why: string }).why);

describe('building', () => {
  it('places a structure on the 2 m grid, charges gold and blocks pathing', () => {
    const w = new World({ seed: 1337, minionWaves: false });
    const h = heroAt(w, 'a', 0, -30, -36);
    w.queue('a', { type: 'build', kind: 'arrow', x: -29.4, y: -40.8 }); w.step();
    const b = bulwarks(w, 0)[0]!;
    expect(b).toBeDefined();
    expect(b.pos).toEqual({ x: -30, y: -40 });
    expect(h.gold! - ECON.passivePerSec).toBeLessThanOrEqual(ECON.startGold - BULWARKS.arrow.levels[0].cost); // (+ passive income tick)
    expect(w.nav.isWalkable({ x: -30.5, y: -40.5 })).toBe(false);
  });
  it('refuses enemy territory, missing gold, far-away sites and occupied cells', () => {
    const w = new World({ seed: 1337, minionWaves: false });
    const h = heroAt(w, 'a', 0, 10, 10);
    w.queue('a', { type: 'build', kind: 'arrow', x: 12, y: 12 }); w.step();
    expect(lastDeny(w)).toContain('outside your territory');
    h.pos = { x: -30, y: -36 }; h.gold = 10;
    w.queue('a', { type: 'build', kind: 'arrow', x: -30, y: -40 }); w.step();
    expect(lastDeny(w)).toContain('not enough gold');
    h.gold = 1000;
    w.queue('a', { type: 'build', kind: 'arrow', x: -30, y: -10 }); w.step();
    expect(lastDeny(w)).toContain('too far');
    expect(bulwarks(w).length).toBe(0);
  });
  it('never lets a team seal a lane completely', () => {
    const w = new World({ seed: 1337, minionWaves: false });
    const h = heroAt(w, 'a', 0, -40, -40);
    h.gold = 100000;
    // Try to wall a full line across the mid lane (perpendicular to it) — the last gap must be refused.
    let denied = 0;
    for (let k = -14; k <= 14; k += 2) {
      h.pos = { x: -40 + k / 2, y: -40 - k / 2 };
      w.queue('a', { type: 'build', kind: 'palisade', x: -40 + k, y: -40 - k }); w.step();
      denied += lastDeny(w).filter((d) => d.includes('seal')).length;
    }
    const goals = new Set<number>();
    const heart = w.map.bases[0].pos;
    for (let i = 0; i < w.nav.size * w.nav.size; i++) { const p = w.nav.toWorld(i % w.nav.size, (i / w.nav.size) | 0); if (Math.hypot(p.x - heart.x, p.y - heart.y) < 4.6) goals.add(i); }
    for (const lane of ['top', 'mid', 'bot'] as const) expect(w.nav.reachable(w.lanePoints(lane, 1)[0]!, goals)).toBe(true);
    expect(bulwarks(w).length).toBeGreaterThan(3);
    void denied;
  });
  it('upgrades raise level and HP; selling refunds 70% and frees the ground', () => {
    const w = new World({ seed: 1337, minionWaves: false });
    const h = heroAt(w, 'a', 0, -30, -36); h.gold = 1000;
    w.queue('a', { type: 'build', kind: 'arrow', x: -30, y: -40 }); w.step();
    const b = bulwarks(w)[0]!;
    w.queue('a', { type: 'upgrade', id: b.id }); w.step();
    expect(b.bw!.level).toBe(2);
    expect(b.maxHp).toBe(BULWARKS.arrow.levels[1].hp);
    const before = h.gold!;
    w.queue('a', { type: 'sell', id: b.id }); w.step();
    expect(w.entities.has(b.id)).toBe(false);
    expect(Math.round(h.gold! - before)).toBe(Math.floor((100 + 70) * ECON.sellRefund) + 0);
    expect(w.nav.isWalkable({ x: -30.5, y: -40.5 })).toBe(true);
  });
});

describe('defending', () => {
  it('a Watch Tower kills wave units and pays its owner the bounty', () => {
    const w = new World({ seed: 1337, minionWaves: true });
    const h = heroAt(w, 'a', 1, 20, 20); h.gold = 1000;
    // Dusk fortifies mid beside the road, where Dawn's first wave will walk past.
    for (const [x, y] of [[26, 18], [18, 26], [30, 22]] as const) { h.pos = { x: x - 2, y: y - 2 }; w.queue('a', { type: 'build', kind: 'arrow', x, y }); w.step(); }
    h.pos = { x: 60, y: 60 }; // hero goes home: kills must come from the towers
    const gold0 = h.gold!;
    steps(w, TICK_RATE * 40);
    expect(h.gold!).toBeGreaterThan(gold0 + UNITS.minion.bounty);
  });
  it('minions maze around a palisade line and still reach (and leak into) the Heartstone', () => {
    const w = new World({ seed: 1337, minionWaves: true });
    // Remove Dusk's gate towers and all heroes: an undefended lane must leak.
    for (const e of [...w.entities.values()]) if (e.kind === 'tower' && e.team === 1) w.entities.delete(e.id);
    const h = heroAt(w, 'a', 1, 30, 30); h.gold = 100000;
    for (let k = -4; k <= 8; k += 2) { h.pos = { x: 30 + k, y: 30 - k + 2 }; w.queue('a', { type: 'build', kind: 'palisade', x: 30 + k, y: 30 - k }); w.step(); }
    h.pos = { x: 70, y: 70 }; h.deadTicks = 99999; // out of the fight
    const heart = [...w.entities.values()].find((e) => e.kind === 'heart' && e.team === 1)!;
    let leaks = 0;
    for (let t = 0; t < TICK_RATE * 80; t++) {
      for (const e of [...w.entities.values()]) if (e.kind === 'minion' && e.team === 1) w.entities.delete(e.id); // undefended
      w.step();
      leaks += (w.snapshot().ev ?? []).filter((e) => e.e === 'leak' && e.t === 1).length;
      for (const e of w.entities.values()) if (e.kind === 'minion') expect(w.nav.isWalkable(e.pos)).toBe(true);
    }
    expect(leaks).toBeGreaterThan(0);
    expect(heart.hp).toBeLessThan(heart.maxHp);
  });
  it('Rime Totem slows enemies in its aura', () => {
    const w = new World({ seed: 1337, minionWaves: false });
    const h = heroAt(w, 'a', 0, -30, -36); h.gold = 1000;
    w.queue('a', { type: 'build', kind: 'frost', x: -30, y: -40 }); w.step();
    const foe = heroAt(w, 'b', 1, -33, -42);
    steps(w, 2);
    expect(foe.slowTicks).toBeGreaterThan(0);
    expect(w.speedMul(foe)).toBeLessThan(1);
  });
});

describe('waves, sends and the economy', () => {
  it('sends add units to the next enemy wave and raise income', () => {
    const w = new World({ seed: 1337, minionWaves: true, structures: false });
    const h = heroAt(w, 'a', 0, -60, -60); h.gold = 1000;
    w.queue('a', { type: 'send', unit: 'brute', lane: 'mid' }); w.step();
    expect(h.income).toBe(ECON.baseIncome + SENDS.brute.income);
    steps(w, TICK_RATE * WAVES.first + 2);
    const brutes = [...w.entities.values()].filter((e: Entity) => e.unit === 'brute');
    expect(brutes.length).toBe(1);
    expect(brutes[0]!.team).toBe(0);
    expect(brutes[0]!.lane).toBe('mid');
  });
  it('waves grow stronger and bring a troll every 5th wave; heroes are paid income each wave', () => {
    const w = new World({ seed: 1337, minionWaves: true, structures: false });
    const h = heroAt(w, 'a', 0, -60, -60);
    const g0 = h.gold!;
    steps(w, TICK_RATE * (WAVES.first + WAVES.interval * 4) + 2);
    expect(w.wave).toBe(5);
    expect([...w.entities.values()].some((e) => e.unit === 'troll')).toBe(true);
    expect(h.gold!).toBeGreaterThanOrEqual(g0 + ECON.baseIncome * 5);
  });
  it('bots fortify their lanes', () => {
    const w = new World({ seed: 9, botsPerTeam: 3 }); w.fillBots();
    steps(w, TICK_RATE * 150);
    expect(bulwarks(w, 0).length).toBeGreaterThan(0);
    expect(bulwarks(w, 1).length).toBeGreaterThan(0);
  });
});
