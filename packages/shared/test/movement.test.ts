import { describe, it, expect } from 'vitest';
import { World, moveWithCollision, terrainHeight, createMap, DT, HERO_SPEED, decodeClient, WATER_LEVEL } from '../src/index.js';

describe('analog input movement', () => {
  it('client prediction with the shared step matches the server exactly', () => {
    const w = new World({ seed: 3, minionWaves: false });
    const hero = w.spawnHero('p', 0);
    let predicted = { ...hero.pos };
    for (let seq = 1; seq <= 90; seq++) {
      const mx = Math.cos(seq * 0.05), my = Math.sin(seq * 0.05);
      w.queue('p', { type: 'input', seq, mx, my });
      predicted = moveWithCollision(w.nav, predicted, mx * HERO_SPEED * DT, my * HERO_SPEED * DT);
      w.step();
    }
    expect(hero.lastSeq).toBe(90);
    expect(hero.pos.x).toBeCloseTo(predicted.x, 6);
    expect(hero.pos.y).toBeCloseTo(predicted.y, 6);
  });
  it('never walks into obstacles (wall sliding)', () => {
    const w = new World({ seed: 3, minionWaves: false });
    const hero = w.spawnHero('p', 0);
    for (let seq = 1; seq <= 600; seq++) { w.queue('p', { type: 'input', seq, mx: 0.6, my: 0.8 }); w.step(); expect(w.nav.isWalkable(hero.pos)).toBe(true); }
  });
  it('clamps oversized input vectors (speed hacks)', () => {
    const w = new World({ seed: 3, minionWaves: false });
    const hero = w.spawnHero('p', 0);
    const start = { ...hero.pos };
    w.queue('p', { type: 'input', seq: 1, mx: 50, my: 0 }); w.step();
    expect(Math.hypot(hero.pos.x - start.x, hero.pos.y - start.y)).toBeLessThanOrEqual(HERO_SPEED * DT + 1e-6);
  });
  it('ignores stale or replayed input sequence numbers', () => {
    const w = new World({ seed: 3, minionWaves: false });
    const hero = w.spawnHero('p', 0);
    w.queue('p', { type: 'input', seq: 5, mx: 1, my: 0 }); w.step();
    const p = { ...hero.pos };
    w.queue('p', { type: 'input', seq: 5, mx: 0, my: 1 }); w.queue('p', { type: 'input', seq: 2, mx: 0, my: 1 }); w.step();
    expect(hero.pos.y).toBeCloseTo(p.y, 6); // replayed inputs dropped; last valid input (x-only) repeats
  });
  it('rejects malformed input commands', () => {
    expect(decodeClient(JSON.stringify({ op: 'cmd', seq: 1, cmd: { type: 'input', seq: 1.5, mx: 0, my: 0 } }))).toBeNull();
    expect(decodeClient(JSON.stringify({ op: 'cmd', seq: 1, cmd: { type: 'input', seq: 2, mx: null, my: 0 } }))).toBeNull();
  });
});

describe('terrain', () => {
  const map = createMap(1337);
  it('is deterministic', () => expect(terrainHeight(map, 12.3, -40.1)).toBe(terrainHeight(createMap(1337), 12.3, -40.1)));
  it('carves the river below water level and lifts mountains outside the valley', () => {
    expect(terrainHeight(map, 0, 0)).toBeLessThan(WATER_LEVEL);
    expect(terrainHeight(map, 0, 200)).toBeGreaterThan(40);
  });
  it('keeps fort plateaus flat', () => {
    const b = map.bases[0].pos;
    expect(Math.abs(terrainHeight(map, b.x, b.y) - terrainHeight(map, b.x + 4, b.y + 3))).toBeLessThan(0.05);
  });
});

describe('forts', () => {
  const w = new World({ seed: 1337, minionWaves: false });
  it('walls block walking straight out of the fort except through lane gates', () => {
    const walls = w.map.obstacles.filter((o) => o.kind === 'wall');
    expect(walls.length).toBeGreaterThan(60);
    for (const o of walls) expect(w.nav.isWalkable({ x: o.x, y: o.y })).toBe(false);
  });
  it('stops a hero whose input stream stalls', () => {
    const hero = w.spawnHero('s', 0);
    w.queue('s', { type: 'input', seq: 1, mx: 0, my: 1 });
    for (let i = 0; i < 30; i++) w.step();
    expect(hero.moving).toBe(false);
  });
});
