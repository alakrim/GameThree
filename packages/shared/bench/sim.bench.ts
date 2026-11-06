import { World, TICK_RATE } from '../src/index.js';
// Server budget check: a full 3v3 bot match (towers, waves, abilities, pathfinding) must step far below 33 ms/tick.
const w = new World({ seed: 1, botsPerTeam: 3 });
w.fillBots();
const ticks = TICK_RATE * 300;
let worst = 0;
const t0 = performance.now();
for (let t = 0; t < ticks; t++) { const a = performance.now(); w.step(); w.snapshot(); worst = Math.max(worst, performance.now() - a); }
const ms = performance.now() - t0;
console.log(`${ticks} ticks (5 min 3v3 bots), ${w.entities.size} entities at end: ${(ms / ticks).toFixed(3)} ms/tick avg, worst ${worst.toFixed(2)} ms (${((ms / ticks) / (1000 / TICK_RATE) * 100).toFixed(1)}% of budget)`);
