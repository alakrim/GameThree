import { World, TICK_RATE } from '../src/index.js';
// Server budget check: one match must step far below 33 ms/tick.
const w = new World({ seed: 1 });
for (let i = 0; i < 10; i++) w.spawnHero(`p${i}`, (i % 2) as 0 | 1);
const ticks = TICK_RATE * 120;
const t0 = performance.now();
for (let t = 0; t < ticks; t++) {
  if (t % 15 === 0) for (let i = 0; i < 10; i++) w.queue(`p${i}`, { type: 'move', x: Math.sin(t + i) * 60, y: Math.cos(t * 0.7 + i) * 60 });
  w.step();
}
const ms = performance.now() - t0;
console.log(`${ticks} ticks, ${w.entities.size} entities at end: ${(ms / ticks).toFixed(3)} ms/tick avg (${((ms / ticks) / (1000 / TICK_RATE) * 100).toFixed(1)}% of budget)`);
