import { describe, it, expect } from 'vitest';
import { World, HEROES, TICK_RATE, ITEMS, BULWARKS, ECON, investedIn, type Entity } from '../src/index.js';

const quiet = () => new World({ seed: 1337, minionWaves: false, structures: false });
const steps = (w: World, n: number) => { for (let i = 0; i < n; i++) w.step(); };
const secs = (w: World, s: number) => steps(w, Math.round(s * TICK_RATE));
const place = (e: Entity, x: number, y: number) => { e.pos = { x, y }; };
/** Test-only: drop a structure straight into the world (bypasses placement rules). */
const addBulwark = (w: World, team: 0 | 1, type: 'palisade' | 'arrow', x: number, y: number, owner = 'nobody') => {
  const lvl = BULWARKS[type].levels[0];
  const cells = w.nav.footprint(x, y); w.nav.block(cells, true);
  return (w as unknown as { add(e: Omit<Entity, 'id'>): Entity }).add({ kind: 'bulwark', team, pos: { x, y }, facing: 0, radius: 1, speed: 0, hp: lvl.hp, maxHp: lvl.hp, path: [], moving: false,
    damage: lvl.damage ?? 0, atkTicks: 0, stunTicks: 0, slowTicks: 0, slowPct: 0, hasteTicks: 0, hastePct: 0, bw: { type, level: 1, owner, cells, charges: 0 } });
};
const minion = (w: World, team: 0 | 1, x: number, y: number) =>
  (w as unknown as { add(e: Omit<Entity, 'id'>): Entity }).add({ kind: 'minion', unit: 'minion', team, pos: { x, y }, facing: 0, radius: 0.45, speed: 0, hp: 300, maxHp: 300, path: [], moving: false,
    damage: 0, atkTicks: 999, stunTicks: 0, slowTicks: 0, slowPct: 0, hasteTicks: 0, hastePct: 0, lane: 'mid' });
const cast = (w: World, who: string, slot: number, aim: number, tx?: number, ty?: number) => w.queue(who, { type: 'act', slot, aim, tx, ty });

describe('Hilde Longwatch', () => {
  it('Split Shot forks after 8 m: two flanking targets each take half damage, the gap between them is safe', () => {
    const w = quiet();
    const h = w.spawnHero('h', 0, 'hilde');
    const l = w.spawnHero('l', 1, 'hrodvar'), r = w.spawnHero('r', 1, 'hrodvar'), mid = w.spawnHero('m', 1, 'hrodvar');
    place(h, 0, 10); place(l, 15, 11.35); place(r, 15, 8.65); place(mid, 15, 10);
    cast(w, 'h', 1, 0); secs(w, 1);
    const half = HEROES.hilde!.abilities[0].damage / 2;
    expect(l.maxHp - l.hp).toBeCloseTo(half, 0);
    expect(r.maxHp - r.hp).toBeCloseTo(half, 0);
    expect(mid.hp).toBe(mid.maxHp);
  });
  it('Cairn Snare arms, then roots the first enemy hero to walk in (who can still attack), max two snares', () => {
    const w = quiet();
    const h = w.spawnHero('h', 0, 'hilde'), v = w.spawnHero('v', 1, 'hrodvar');
    place(h, 0, 10); place(v, 6, 4);
    cast(w, 'h', 2, 0, 6, 10); secs(w, 1);
    const traps = () => [...w.entities.values()].filter((e) => e.kind === 'trap');
    expect(traps()).toHaveLength(1);
    // Walk the victim north into the snare.
    let seq = 0;
    for (let i = 0; i < 40 && !(v.rootTicks! > 0); i++) { w.queue('v', { type: 'input', seq: ++seq, mx: 0, my: 1 }); w.step(); }
    expect(v.rootTicks).toBeGreaterThan(0);
    expect(traps()).toHaveLength(0);
    const p = { ...v.pos };
    for (let i = 0; i < 10; i++) { w.queue('v', { type: 'input', seq: ++seq, mx: 0, my: 1 }); w.step(); }
    expect(v.pos).toEqual(p);                         // rooted: no movement…
    expect(w.speedMul(v)).toBe(0);
    // …but attacks still go out.
    w.queue('v', { type: 'act', slot: 0, aim: 0 }); w.step();
    expect(v.cds![0]).toBeGreaterThan(0);
    // Third snare replaces the oldest.
    for (let k = 0; k < 3; k++) { h.cds![2] = 0; cast(w, 'h', 2, 0, 2 + k * 3, 16); secs(w, 0.4); }
    expect(traps()).toHaveLength(2);
  });
  it('Winter Rain telegraphs, then lands nine volleys; structures take half from area damage', () => {
    const w = quiet();
    const h = w.spawnHero('h', 0, 'hilde'), v = w.spawnHero('v', 1, 'brynna');
    const wall = addBulwark(w, 1, 'arrow', 14, 12);
    place(h, 0, 10); place(v, 14, 8); v.stunTicks = 300;
    cast(w, 'h', 3, 0, 14, 10); w.step();
    expect(w.snapshot().ev!.some((e) => e.e === 'tele')).toBe(true);
    secs(w, 1.6);
    expect(v.hp).toBe(v.maxHp);
    secs(w, 2.6);
    const per = HEROES.hilde!.abilities[2].damage;
    expect(v.maxHp - v.hp).toBeCloseTo(per * 9, 0);
    expect(wall.maxHp - wall.hp).toBeCloseTo(per * 9 * 0.5, 0);
    expect(v.slowTicks).toBeGreaterThan(0);
  });
});

describe('Brynna Chainhook', () => {
  it('Hooked Reel passes minions, catches the hero, drags them ~4 m and slows them', () => {
    const w = quiet();
    const b = w.spawnHero('b', 0, 'brynna'), v = w.spawnHero('v', 1, 'sigrun');
    minion(w, 1, 4, 10);
    place(b, 0, 10); place(v, 9, 10);
    cast(w, 'b', 1, 0); secs(w, 1);
    expect(v.hp).toBeLessThan(v.maxHp);
    expect(v.pos.x).toBeGreaterThan(4.5); expect(v.pos.x).toBeLessThan(5.6);
    expect(v.slowTicks).toBeGreaterThan(0);
  });
  it('palisades stop hooks', () => {
    const w = quiet();
    const b = w.spawnHero('b', 0, 'brynna'), v = w.spawnHero('v', 1, 'sigrun');
    addBulwark(w, 1, 'palisade', 4, 10);
    place(b, 0, 10); place(v, 9, 10);
    cast(w, 'b', 1, 0); secs(w, 1);
    expect(v.hp).toBe(v.maxHp);
    expect(v.pos.x).toBe(9);
  });
  it('Last Link hauls the target all the way in and stuns on arrival', () => {
    const w = quiet();
    const b = w.spawnHero('b', 0, 'brynna'), v = w.spawnHero('v', 1, 'hilde');
    place(b, 0, 10); place(v, 12, 10);
    cast(w, 'b', 3, 0);
    let stunnedWhileFlying = false;
    for (let i = 0; i < 40; i++) { w.step(); if (v.forced && v.stunTicks > 0) stunnedWhileFlying = true; }
    expect(stunnedWhileFlying).toBe(false);
    expect(v.pos.x).toBeLessThan(2.6);
    expect(v.stunTicks + 20).toBeGreaterThan(0);
    expect(v.hp).toBeLessThan(v.maxHp);
  });
  it('Chain Whirl damages and throws enemies outward; trolls stand firm', () => {
    const w = quiet();
    const b = w.spawnHero('b', 0, 'brynna'), v = w.spawnHero('v', 1, 'sigrun');
    place(b, 5, 10); place(v, 7, 10);
    cast(w, 'b', 2, 0); secs(w, 1);
    expect(v.hp).toBeLessThan(v.maxHp);
    expect(v.pos.x).toBeGreaterThan(9.5);
  });
  it('every third landed jab reels the target in', () => {
    const w = quiet();
    const b = w.spawnHero('b', 0, 'brynna'), v = w.spawnHero('v', 1, 'hrodvar');
    place(b, 0, 10); place(v, 5, 10); v.stunTicks = 1000;
    for (let k = 0; k < 2; k++) { b.cds![0] = 0; cast(w, 'b', 0, 0); secs(w, 0.5); }
    expect(v.pos.x).toBe(5);
    b.cds![0] = 0; cast(w, 'b', 0, 0); secs(w, 0.5);
    expect(v.pos.x).toBeLessThan(4.5);
  });
});

describe('Halla Lanternkeep', () => {
  it('Lantern Beam heals the first ally and burns the first enemy behind it', () => {
    const w = quiet();
    const h = w.spawnHero('h', 0, 'halla'), ally = w.spawnHero('a', 0, 'hrodvar'), foe = w.spawnHero('f', 1, 'hrodvar');
    place(h, 0, 10); place(ally, 4, 10); place(foe, 9, 10);
    ally.hp = 200;
    cast(w, 'h', 1, 0); secs(w, 1);
    expect(ally.hp).toBeCloseTo(200 + HEROES.halla!.abilities[0].heal!, 0);
    expect(foe.hp).toBe(foe.maxHp - HEROES.halla!.abilities[0].damage);
  });
  it('Thread of Warmth passes enemies, shields the ally, and the shield absorbs damage then expires', () => {
    const w = quiet();
    const h = w.spawnHero('h', 0, 'halla'), ally = w.spawnHero('a', 0, 'hrodvar'), foe = w.spawnHero('f', 1, 'hrodvar');
    place(h, 0, 10); place(foe, 4, 10); place(ally, 8, 10);
    cast(w, 'h', 2, 0); secs(w, 0.8);
    expect(foe.shieldHp ?? 0).toBe(0);
    const sh = ally.shieldHp!;
    expect(sh).toBeCloseTo(HEROES.halla!.abilities[1].shield!.flat + HEROES.halla!.abilities[1].shield!.pct * ally.maxHp, 0);
    place(foe, 10, 10); foe.facing = Math.PI;
    w.queue('f', { type: 'act', slot: 0, aim: Math.PI }); secs(w, 0.5);
    expect(ally.hp).toBe(ally.maxHp);                  // absorbed
    expect(ally.shieldHp).toBeCloseTo(sh - HEROES.hrodvar!.damage, 0);
    secs(w, 3);
    expect(ally.shieldHp).toBe(0);
  });
  it('Dawnfire Ring heals allies (and Halla) 25% over 3 s and never repairs structures', () => {
    const w = quiet();
    const h = w.spawnHero('h', 0, 'halla'), ally = w.spawnHero('a', 0, 'hrodvar');
    const wall = addBulwark(w, 0, 'palisade', 8, 12);
    place(h, 4, 10); place(ally, 6, 10);
    ally.hp = 100; h.hp = 100; wall.hp = 100;
    cast(w, 'h', 3, 0); secs(w, 4);
    expect(ally.hp).toBeCloseTo(100 + ally.maxHp * 0.25, 0);
    expect(h.hp).toBeCloseTo(100 + h.maxHp * 0.25, 0);
    expect(wall.hp).toBe(100);
  });
});

describe('crowd-control rules', () => {
  it('diminishing returns: full, half, then immune', () => {
    const w = quiet();
    const a = w.spawnHero('a', 0, 'hrodvar'), v = w.spawnHero('v', 1, 'sigrun');
    const stun = () => { a.cds![1] = 0; place(a, 0, 10); place(v, 4, 10); v.stunTicks = 0; cast(w, 'a', 1, 0); for (let i = 0; i < 10 && !v.stunTicks; i++) w.step(); return v.stunTicks; };
    const s1 = stun(); secs(w, 1);
    const s2 = stun(); secs(w, 1);
    const s3 = stun();
    expect(s1).toBeGreaterThan(20);
    expect(s2).toBeLessThan(s1 * 0.6);
    expect(s3).toBe(0);
    secs(w, 4);
    expect(stun()).toBeGreaterThan(20);                 // window and immunity expired
  });
});

describe('repair', () => {
  it('restores a friendly bulwark for gold; walking away or taking a hero hit breaks the channel', () => {
    const w = quiet();
    const h = w.spawnHero('h', 0, 'hrodvar'), foe = w.spawnHero('f', 1, 'sigrun');
    const tower = addBulwark(w, 0, 'arrow', 6, 12, 'h');
    place(h, 4, 10); place(foe, -10, 0); h.gold = 500;
    tower.hp = 200;
    w.queue('h', { type: 'repair', id: tower.id }); secs(w, 2);
    const gained = tower.hp - 200;
    expect(gained).toBeGreaterThan(tower.maxHp * 0.12);
    const spent = w.matchSummary().heroes.find((l) => l.owner === 'h')!.spent.repair;
    expect(spent).toBeCloseTo(investedIn('arrow', 1) * 0.45 * (gained / tower.maxHp), 1);
    expect(h.repair).toBe(tower.id);
    // A hit from an enemy hero interrupts.
    place(foe, 4, 14); w.queue('f', { type: 'act', slot: 0, aim: -Math.PI / 2 }); secs(w, 1);
    expect(h.repair).toBeUndefined();
    // Moving interrupts.
    w.queue('h', { type: 'repair', id: tower.id }); w.step();
    expect(h.repair).toBe(tower.id);
    w.queue('h', { type: 'input', seq: 1, mx: -1, my: 0 }); w.step();
    expect(h.repair).toBeUndefined();
  });
  it('refuses enemy structures, caltrops, full health and distance', () => {
    const w = quiet();
    const h = w.spawnHero('h', 0, 'hrodvar');
    const enemy = addBulwark(w, 1, 'arrow', 6, 12), far = addBulwark(w, 0, 'arrow', 20, 12);
    place(h, 4, 10); far.hp = 10;
    for (const id of [enemy.id, far.id]) { w.queue('h', { type: 'repair', id }); w.step(); expect(h.repair).toBeUndefined(); }
    const denies = w.snapshot().ev!.filter((e) => e.e === 'deny');
    expect(denies.length).toBe(2);
  });
});

describe('items', () => {
  it('only sold at your fort; stats apply; selling refunds 60%', () => {
    const w = quiet();
    const h = w.spawnHero('h', 0, 'hrodvar');
    h.gold = 2000;
    place(h, 0, 10);
    w.queue('h', { type: 'buy', item: 'mantle' }); w.step();
    expect(h.items).toEqual([]);
    place(h, w.map.bases[0].pos.x + 3, w.map.bases[0].pos.y + 3);
    const hp0 = h.maxHp, dmg0 = h.damage;
    for (const it of ['mantle', 'edge', 'plate', 'rune']) { w.queue('h', { type: 'buy', item: it }); w.step(); }
    expect(h.items).toEqual(['mantle', 'edge', 'plate', 'rune']);
    expect(h.maxHp).toBe(hp0 + ITEMS.mantle.stats.hp! + ITEMS.plate.stats.hp!);
    expect(h.damage).toBe(dmg0 + ITEMS.edge.stats.dmg!);
    w.queue('h', { type: 'buy', item: 'boots' }); w.step();
    expect(h.items).toHaveLength(4);                   // slots full
    const g = h.gold!;
    w.queue('h', { type: 'sellItem', slot: 1 }); w.step();
    expect(h.gold! - g).toBeGreaterThanOrEqual(Math.floor(ITEMS.edge.cost * 0.6));
    expect(h.damage).toBe(dmg0);
  });
  it('cooldown reduction and armor work in combat', () => {
    const w = quiet();
    const a = w.spawnHero('a', 0, 'sigrun'), b = w.spawnHero('b', 1, 'hrodvar');
    a.gold = b.gold = 2000;
    for (const [e, it] of [[a, 'rune'], [b, 'plate']] as const) { place(e, w.map.bases[e.team].pos.x + 3, w.map.bases[e.team].pos.y + 3); w.queue(e.owner!, { type: 'buy', item: it }); }
    w.step();
    place(a, 0, 10); place(b, 6, 10);
    cast(w, 'a', 1, 0); w.step();
    expect(a.cds![1]).toBeLessThan(Math.round(HEROES.sigrun!.abilities[0].cooldown * TICK_RATE * 0.9));
    secs(w, 1);
    expect(b.maxHp - b.hp).toBeCloseTo(HEROES.sigrun!.abilities[0].damage * 1.08 * 0.88, 0);
  });
});

describe('kills and assists', () => {
  it('credits the killer, pays assisting heroes and emits a kill-feed event', () => {
    const w = quiet();
    const a = w.spawnHero('a', 0, 'hrodvar'), b = w.spawnHero('b', 0, 'sigrun'), v = w.spawnHero('v', 1, 'hilde');
    place(a, 0, 10); place(b, -6, 10); place(v, 2, 10); v.stunTicks = 300;
    w.queue('b', { type: 'act', slot: 0, aim: 0 }); secs(w, 1);
    expect(v.hp).toBeLessThan(v.maxHp);
    v.hp = 10; const gb = b.gold!;
    w.queue('a', { type: 'act', slot: 0, aim: 0 }); secs(w, 0.5);
    expect(v.deadTicks).toBeGreaterThan(0);
    expect(a.kills).toBe(1); expect(v.deaths).toBe(1);
    expect(b.gold! - gb).toBeGreaterThanOrEqual(50);
    const s = w.matchSummary();
    expect(s.heroes.find((h) => h.owner === 'b')!.assists).toBe(1);
  });
});

describe('Hearth Recall', () => {
  it('channels home; moving or damage cancels', () => {
    const w = quiet();
    const h = w.spawnHero('h', 0, 'hilde');
    place(h, 0, 10);
    w.queue('h', { type: 'recall' }); secs(w, 2);
    w.queue('h', { type: 'input', seq: 1, mx: 1, my: 0 }); w.step();
    expect(h.recall).toBeUndefined();
    w.queue('h', { type: 'input', seq: 2, mx: 0, my: 0 }); w.step();
    w.queue('h', { type: 'recall' }); secs(w, 4.2);
    expect(Math.hypot(h.pos.x - w.map.bases[0].pos.x, h.pos.y - w.map.bases[0].pos.y)).toBeLessThan(8);
  });
});

describe('structure allowance', () => {
  it('each hero owns at most capPerHero structures, so a newcomer can still build in a bot-filled match', () => {
    const w = quiet();
    const bot = w.spawnHero('bot', 0, 'hrodvar'), human = w.spawnHero('human', 0, 'hilde');
    bot.gold = human.gold = 5000;
    const sites: [number, number][] = [];
    for (let x = -40; x <= -20 && sites.length < 14; x += 2) for (let y = -40; y <= -20 && sites.length < 14; y += 4) if (!World.siteProblem(w, 0, x, y)) sites.push([x, y]);
    expect(sites.length).toBeGreaterThanOrEqual(12);
    for (const [x, y] of sites.slice(0, 12)) { place(bot, x + 3, y + 3); w.queue('bot', { type: 'build', kind: 'spikes', x, y }); w.step(); }
    const owned = (o: string) => [...w.entities.values()].filter((e) => e.kind === 'bulwark' && e.bw!.owner === o).length;
    expect(owned('bot')).toBe(ECON.capPerHero);
    expect(w.canBuildMore('bot', 0)).toBe(false);
    expect(w.canBuildMore('human', 0)).toBe(true);
    const [hx, hy] = sites[12]!;
    place(human, hx + 3, hy + 3); w.queue('human', { type: 'build', kind: 'spikes', x: hx, y: hy }); w.step();
    expect(owned('human')).toBe(1);
  });
});

describe('telemetry', () => {
  it('a bot match produces a coherent report (kills = deaths credited, gold earned, damage by type)', () => {
    const w = new World({ seed: 7, botsPerTeam: 3 });
    w.fillBots();
    const heroIds = [...w.entities.values()].filter((e) => e.kind === 'hero').map((e) => e.heroId);
    expect(new Set(heroIds).size).toBeGreaterThanOrEqual(4);   // varied line-ups
    secs(w, 240);
    const s = w.matchSummary();
    expect(s.heroes).toHaveLength(6);
    const kills = s.heroes.reduce((n, h) => n + h.kills, 0), deaths = s.heroes.reduce((n, h) => n + h.deaths, 0);
    expect(kills).toBeLessThanOrEqual(deaths);
    for (const h of s.heroes) {
      expect(h.goldEarned).toBeGreaterThan(240);
      expect(h.dmgUnits + h.dmgHeroes + h.dmgStructs).toBeGreaterThan(0);
    }
    expect(s.heartHpByMinute.length).toBeGreaterThanOrEqual(4);
    expect(s.heroes.some((h) => h.items.length > 0)).toBe(true);
  });
});
