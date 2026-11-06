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
  ['offline-desktop', `${base}/?quality=medium`, { width: 1280, height: 720 }],
  ['online-desktop', `${base}/?quality=low&server=ws://localhost:8787`, { width: 1280, height: 720 }],
  ['offline-phone', `${base}/?quality=low`, { width: 390, height: 844, isMobile: true, hasTouch: true }],
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('fonts.g') && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.__lumen?.predictor?.pos, null, { timeout: 120000 });
  const pos = () => page.evaluate(() => ({ ...window.__lumen.predictor.pos }));
  const p0 = await pos();
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
  await page.waitForTimeout(800);
  const p1 = await pos();
  // Authoritative check: server-side hero (latest snapshot) must agree with the prediction.
  const drift = await page.evaluate(() => {
    const L = window.__lumen, me = [...L.views.values()].find((v) => v.isLocal);
    return me ? Math.hypot(me.root.position.x - L.predictor.pos.x, -me.root.position.z - L.predictor.pos.y) : -1;
  });
  await page.screenshot({ path: `${out}/${name}.png` });
  const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const ok = moved > 4 && errors.length === 0 && drift >= 0 && drift < 0.5;
  failed ||= !ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: moved ${moved.toFixed(1)} m, render/predict drift ${drift.toFixed(2)}, errors=${errors.length}${errors.length ? ' ' + errors.slice(0, 3).join(' | ').slice(0, 600) : ''}`);
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
