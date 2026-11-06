import { describe, it, expect } from 'vitest';
import { Rng, createMap, NavGrid, World, decodeClient, encode, PROTOCOL_VERSION, dist, TICK_RATE } from '../src/index.js';

describe('Rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const sa = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(sa);
  });
});

describe('Map', () => {
  const map = createMap(1337);
  it('is point-symmetric for fairness', () => {
    for (const o of map.obstacles) {
      expect(map.obstacles.some((m) => Math.abs(m.x + o.x) < 1e-9 && Math.abs(m.y + o.y) < 1e-9 && m.r === o.r)).toBe(true);
    }
  });
  it('keeps every lane walkable end-to-end', () => {
    const nav = new NavGrid(map);
    for (const lane of Object.values(map.lanes)) {
      for (let i = 0; i < lane.length - 1; i++) expect(nav.lineOfSight(lane[i]!, lane[i + 1]!)).toBe(true);
    }
  });
  it('has a populated jungle', () => expect(map.obstacles.length).toBeGreaterThan(40));
});

describe('NavGrid', () => {
  const map = createMap(1337);
  const nav = new NavGrid(map);
  it('finds a path base to base that never crosses obstacles', () => {
    const from = { x: map.bases[0].pos.x + 4, y: map.bases[0].pos.y + 4 }, to = { x: map.bases[1].pos.x - 4, y: map.bases[1].pos.y - 4 };
    const path = nav.findPath(from, to)!;
    expect(path).not.toBeNull();
    let prev = from;
    for (const p of path) { expect(nav.lineOfSight(prev, p)).toBe(true); prev = p; }
    expect(dist(prev, to)).toBeLessThan(1);
  });
  it('routes around an obstacle', () => {
    const o = map.obstacles[0]!;
    const a = nav.nearestWalkable({ x: o.x - o.r - 2, y: o.y })!, b = nav.nearestWalkable({ x: o.x + o.r + 2, y: o.y })!;
    const path = nav.findPath(a, b);
    expect(path).not.toBeNull();
  });
  it('snaps unwalkable targets to the nearest walkable cell', () => {
    const o = map.obstacles[0]!;
    const p = nav.nearestWalkable({ x: o.x, y: o.y });
    expect(p && nav.isWalkable(p)).toBe(true);
  });
});

describe('World', () => {
  const run = () => {
    const w = new World({ seed: 7 });
    w.spawnHero('p1', 0); w.spawnHero('p2', 1);
    for (let t = 0; t < TICK_RATE * 20; t++) {
      if (t === 3) w.queue('p1', { type: 'move', x: 0, y: 0 });
      if (t === 40) w.queue('p2', { type: 'move', x: -20, y: 30 });
      w.step();
    }
    return w;
  };
  it('is deterministic given the same inputs', () => expect(run().hash()).toBe(run().hash()));
  it('moves a hero to its commanded target', () => {
    const w = run();
    const hero = [...w.entities.values()].find((e) => e.owner === 'p1')!;
    expect(dist(hero.pos, { x: 0, y: 0 })).toBeLessThan(1.5);
    expect(hero.moving).toBe(false);
  });
  it('spawns minion waves that advance down lanes', () => {
    const w = run();
    const minions = [...w.entities.values()].filter((e) => e.kind === 'minion');
    expect(minions.length).toBe(24);
    for (const m of minions) expect(w.nav.isWalkable(m.pos)).toBe(true);
  });
  it('ignores commands from players without a hero', () => {
    const w = new World({ seed: 7, minionWaves: false });
    w.queue('ghost', { type: 'move', x: 10, y: 10 });
    expect(() => w.step()).not.toThrow();
  });
});

describe('protocol', () => {
  it('validates client messages', () => {
    expect(decodeClient(encode({ op: 'hello', v: PROTOCOL_VERSION, name: 'a' }))).not.toBeNull();
    expect(decodeClient(JSON.stringify({ op: 'cmd', seq: 1, cmd: { type: 'move', x: 'NaN', y: 0 } }))).toBeNull();
    expect(decodeClient('{bad json')).toBeNull();
    expect(decodeClient(JSON.stringify({ op: 'hello', v: 999, name: 'a' }))).toBeNull();
  });
});
