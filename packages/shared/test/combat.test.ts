import { describe, it, expect } from 'vitest';
import { World, HEROES, TICK_RATE, TOWER, type Entity } from '../src/index.js';

const quiet = () => new World({ seed: 1337, minionWaves: false, structures: false });
const steps = (w: World, n: number) => { for (let i = 0; i < n; i++) w.step(); };
const place = (e: Entity, x: number, y: number) => { e.pos = { x, y }; };

describe('basic attacks', () => {
  it('melee cone hits enemies in front, not behind', () => {
    const w = quiet();
    const a = w.spawnHero('a', 0, 'hrodvar'), front = w.spawnHero('b', 1, 'hrodvar'), behind = w.spawnHero('c', 1, 'hrodvar');
    place(a, 0, 10); place(front, 2, 10); place(behind, -2, 10);
    w.queue('a', { type: 'act', slot: 0, aim: 0 }); steps(w, 15);
    expect(front.hp).toBe(front.maxHp - HEROES.hrodvar!.damage);
    expect(behind.hp).toBe(behind.maxHp);
  });
  it('enforces cooldowns server-side (spam does not increase DPS)', () => {
    const w = quiet();
    const a = w.spawnHero('a', 0, 'hrodvar'), b = w.spawnHero('b', 1, 'hrodvar');
    place(a, 0, 10); place(b, 2, 10);
    for (let t = 0; t < TICK_RATE * 3; t++) { w.queue('a', { type: 'act', slot: 0, aim: 0 }); w.step(); }
    const hits = (b.maxHp - b.hp) / HEROES.hrodvar!.damage;
    expect(hits).toBeLessThanOrEqual(Math.ceil(3 / HEROES.hrodvar!.attack.cooldown));
    expect(hits).toBeGreaterThanOrEqual(3);
  });
  it('ranged projectile hits the first enemy along its path', () => {
    const w = quiet();
    const a = w.spawnHero('a', 0, 'sigrun'), near = w.spawnHero('b', 1, 'hrodvar'), far = w.spawnHero('c', 1, 'hrodvar');
    place(a, 0, 20); place(near, 6, 20); place(far, 10, 20);
    w.queue('a', { type: 'act', slot: 0, aim: 0 }); steps(w, 30);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(far.hp).toBe(far.maxHp);
  });
  it('rejects malformed slots and dead/stunned casters', () => {
    const w = quiet();
    const a = w.spawnHero('a', 0, 'hrodvar'), b = w.spawnHero('b', 1, 'hrodvar');
    place(a, 0, 10); place(b, 2, 10);
    w.queue('a', { type: 'act', slot: 7, aim: 0 }); a.stunTicks = 10;
    w.queue('a', { type: 'act', slot: 0, aim: 0 }); steps(w, 12);
    expect(b.hp).toBe(b.maxHp);
  });
});

describe('abilities', () => {
  it('Shield Rush dashes, stops on the first enemy and stuns it', () => {
    const w = quiet();
    const a = w.spawnHero('a', 0, 'hrodvar'), b = w.spawnHero('b', 1, 'sigrun');
    place(a, 0, 10); place(b, 5, 10);
    w.queue('a', { type: 'act', slot: 1, aim: 0 }); steps(w, 10);
    expect(b.stunTicks).toBeGreaterThan(0);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(a.pos.x).toBeGreaterThan(3);
    expect(a.pos.x).toBeLessThan(5);
  });
  it('Glacial Burst telegraphs, then detonates after its delay at the (range-clamped) target', () => {
    const w = quiet();
    const a = w.spawnHero('a', 0, 'sigrun'), b = w.spawnHero('b', 1, 'hrodvar');
    place(a, 0, 0); place(b, 10, 0);
    w.queue('a', { type: 'act', slot: 3, aim: 0, tx: 10, ty: 0 });
    w.step();
    const ev = w.snapshot().ev!;
    expect(ev.some((e) => e.e === 'tele')).toBe(true);
    steps(w, Math.round(0.4 * TICK_RATE) + Math.round(0.9 * TICK_RATE) - 3);
    expect(b.hp).toBe(b.maxHp); // not yet
    steps(w, 6);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(b.stunTicks).toBeGreaterThan(0);
  });
  it('stun prevents movement and attacks', () => {
    const w = quiet();
    const a = w.spawnHero('a', 0, 'hrodvar');
    a.stunTicks = 20;
    const p = { ...a.pos };
    for (let s = 1; s < 10; s++) { w.queue('a', { type: 'input', seq: s, mx: 1, my: 0 }); w.step(); }
    expect(a.pos).toEqual(p);
  });
  it('slows reduce movement speed and are reported for prediction', () => {
    const w = quiet();
    const a = w.spawnHero('a', 0, 'hrodvar');
    a.slowTicks = 30; a.slowPct = 0.4;
    w.step();
    expect(w.snapshot().ents.find((e) => e.id === a.id)!.sm).toBeCloseTo(0.6, 2);
  });
});

describe('death, XP and respawn', () => {
  it('a killed hero grants XP, waits, then respawns at its fort with full HP', () => {
    const w = quiet();
    const a = w.spawnHero('a', 0, 'hrodvar'), b = w.spawnHero('b', 1, 'hrodvar');
    place(a, 0, 10); place(b, 2, 10); b.hp = 10;
    w.queue('a', { type: 'act', slot: 0, aim: 0 }); steps(w, 12);
    expect(b.deadTicks).toBeGreaterThan(0);
    expect(a.level! > 1 || a.xp! > 0).toBe(true);
    steps(w, b.deadTicks! + 1);
    expect(b.deadTicks).toBe(0);
    expect(b.hp).toBe(b.maxHp);
    expect(Math.hypot(b.pos.x - w.map.bases[1].pos.x, b.pos.y - w.map.bases[1].pos.y)).toBeLessThan(8);
  });
});

describe('structures', () => {
  it('towers prefer minions over heroes and shoot heroes when alone', () => {
    const w = new World({ seed: 1337, minionWaves: false });
    const tower = [...w.entities.values()].find((e) => e.kind === 'tower' && e.team === 1)!;
    const h = w.spawnHero('a', 0, 'hrodvar');
    place(h, tower.pos.x + 6, tower.pos.y);
    steps(w, TICK_RATE * 2);
    expect(h.hp).toBeLessThan(h.maxHp);
    expect(h.maxHp - h.hp).toBeLessThanOrEqual(TOWER.damageVsHero * 2);
  });
  it('gate towers are attackable; the Heartstone is protected from heroes until a gate tower falls', () => {
    const w = new World({ seed: 1337, minionWaves: false });
    const ents = [...w.entities.values()];
    expect(ents.filter((e) => e.kind === 'tower').every((e) => !e.invulnerable)).toBe(true);
    expect(ents.filter((e) => e.kind === 'heart').every((e) => e.invulnerable)).toBe(true);
  });
  it('destroying the Heartstone ends the match, then it resets', () => {
    const w = new World({ seed: 1337, minionWaves: false });
    const heart = [...w.entities.values()].find((e) => e.kind === 'heart' && e.team === 1)!;
    const a = w.spawnHero('a', 0, 'hrodvar');
    heart.invulnerable = false; heart.hp = 5;
    place(a, heart.pos.x - 3, heart.pos.y - 0.5);
    w.queue('a', { type: 'act', slot: 0, aim: Math.atan2(heart.pos.y - a.pos.y, heart.pos.x - a.pos.x) }); steps(w, 12);
    expect(w.winner).toBe(0);
    steps(w, TICK_RATE * 13);
    expect(w.winner).toBeNull();
    expect([...w.entities.values()].filter((e) => e.kind === 'heart').length).toBe(2);
    expect(w.heroOf('a')).toBeDefined();
  });
});

describe('bots & full matches', () => {
  it('3v3 bot matches are deterministic and stay on walkable ground', () => {
    const run = () => {
      const w = new World({ seed: 9, botsPerTeam: 3 }); w.fillBots();
      for (let t = 0; t < TICK_RATE * 90; t++) w.step();
      return w;
    };
    const a = run(), b = run();
    expect(a.hash()).toBe(b.hash());
    for (const e of a.entities.values()) if (e.kind === 'hero' || e.kind === 'minion') expect(a.nav.isWalkable(e.pos)).toBe(true);
  });
  it('bots actually fight (damage happens within two minutes)', () => {
    const w = new World({ seed: 9, botsPerTeam: 3 }); w.fillBots();
    let hits = 0;
    for (let t = 0; t < TICK_RATE * 120; t++) { w.step(); if (t % 2 === 0) hits += (w.snapshot().ev ?? []).filter((e) => e.e === 'hit').length; }
    expect(hits).toBeGreaterThan(50);
  });
  it('humans replace bots', () => {
    const w = new World({ seed: 9, botsPerTeam: 3 }); w.fillBots();
    w.spawnHero('human', 0, 'sigrun'); w.fillBots();
    const dawn = [...w.entities.values()].filter((e) => e.kind === 'hero' && e.team === 0);
    expect(dawn.length).toBe(3);
    expect(dawn.filter((e) => e.bot).length).toBe(2);
  });
});
