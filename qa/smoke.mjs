// Browser smoke test: boots the client (offline + online + phone), holds W, verifies the hero moves via
// predicted + authoritative movement, captures screenshots, fails on any page/console error.
// Usage: node qa/smoke.mjs [baseUrl] [outDir]   (expects vite on :5173 and, for online, the server on :8787)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
// Resolves a local install or one on NODE_PATH (CI images often ship Playwright globally).
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'qa/out';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let failed = false;
for (const [name, url, vp] of [
  ['offline-desktop', `${base}/?quality=low&hero=hrodvar`, { width: 1280, height: 720 }],
  ['online-desktop', `${base}/?quality=low&hero=sigrun&server=ws://localhost:8787`, { width: 1280, height: 720 }],
  ['offline-phone', `${base}/?quality=low&hero=sigrun`, { width: 390, height: 844, isMobile: true, hasTouch: true }],
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('fonts.g') && errors.push(m.text()));
  console.log(`… ${name}`);
  await page.goto(url);
  await page.waitForFunction(() => window.__lumen?.predictor?.pos, null, { timeout: 400000 });
  const pos = () => page.evaluate(() => ({ ...window.__lumen.predictor.pos }));
  const p0 = await pos();
  // Hold W until the hero has covered 4 m (software-rendered CI runs at ~1 fps, so game time is slow).
  await page.keyboard.down('KeyW');
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { const p = await pos(); if (Math.hypot(p.x - p0.x, p.y - p0.y) > 4) break; await page.waitForTimeout(500); }
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(1500);
  const p1 = await pos();
  // Authoritative check: latest server snapshot of our hero vs the client prediction.
  const serverGap = await page.evaluate(() => {
    const L = window.__lumen; const s = L.interp?.latest; const me = s?.ents.find((e) => e.k === 0 && e.o === L.me?.playerId);
    return me ? Math.hypot(me.x - L.predictor.pos.x, me.y - L.predictor.pos.y) : -1;
  });
  // Authoritative check: server-side hero (latest snapshot) must agree with the prediction.
  const drift = await page.evaluate(() => {
    const L = window.__lumen, me = [...L.views.values()].find((v) => v.isLocal);
    return me ? Math.hypot(me.root.position.x - L.predictor.pos.x, -me.root.position.z - L.predictor.pos.y) : -1;
  });
  // Combat: every slot can be fired (cooldowns respected), and the 3v3 match is populated with bots.
  const fired = [];
  for (const slot of [0, 1, 2, 3]) { fired.push(await page.evaluate((s) => window.__lumen.fire(s), slot)); await page.waitForTimeout(1500); }
  const heroes = await page.evaluate(() => [...window.__lumen.views.values()].filter((v) => v.isHero).length);
  // Tower defence: build a Watch Tower between the fort and the valley centre through the real network path.
  const built = await page.evaluate(async () => {
    const L = window.__lumen, me = L.mine, fort = L.map.bases[L.me.team].pos;
    const dx = -fort.x, dy = -fort.y, l = Math.hypot(dx, dy);
    for (const r of [17, 19, 21, 23]) for (const side of [0, 3, -3, 6, -6]) {
      const x = Math.round((fort.x + (dx / l) * r - (dy / l) * side) / 2) * 2, y = Math.round((fort.y + (dy / l) * r + (dx / l) * side) / 2) * 2;
      if (Math.hypot(x - me.x, y - me.y) > 13) continue;
      L.transport.send({ type: 'build', kind: 'arrow', x, y });
      await new Promise((res) => setTimeout(res, 2500));
      if (L.bulwarkViews.size > 0 && [...L.bulwarkViews.values()].some((b) => b.team === L.me.team)) return true;
    }
    return false;
  });
  const combatOk = fired.every(Boolean) && heroes === 6 && built;
  if (!built) errors.push('build failed');
  if (!combatOk) errors.push(`combat: fired=${fired} heroes=${heroes}`);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
  const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const ok = moved > 4 && errors.length === 0 && drift >= 0 && drift < 0.5 && serverGap >= 0 && serverGap < 1.5;
  failed ||= !ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: moved ${moved.toFixed(1)} m, render/predict drift ${drift.toFixed(2)}, server/predict gap ${serverGap.toFixed(2)}, errors=${errors.length}${errors.length ? ' ' + errors.slice(0, 3).join(' | ').slice(0, 600) : ''}`);
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
