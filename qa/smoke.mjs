// Browser smoke test: boots the client (offline + online), issues a move order, verifies the hero moves, captures screenshots.
// Usage: node qa/smoke.mjs [baseUrl] [outDir]   (expects vite on :5173 and, for online, the server on :8787)
import { createRequire } from 'node:module';
// Resolves a local install or one on NODE_PATH (CI images often ship Playwright globally).
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'qa/out';
import { mkdirSync } from 'node:fs'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
for (const [name, url, vp] of [
  ['offline-desktop', `${base}/?quality=medium`, { width: 1280, height: 720 }],
  ['online-desktop', `${base}/?quality=medium&server=ws://localhost:8787`, { width: 1280, height: 720 }],
  ['offline-phone', `${base}/?quality=low`, { width: 390, height: 844, isMobile: true, hasTouch: true }],
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.__lumen && [...window.__lumen.views.values()].length > 0, null, { timeout: 20000 });
  const heroPos = () => page.evaluate(() => { const v = [...window.__lumen.views.values()].find((x) => x.constructor.name === 'HeroView'); return v ? { x: v.root.position.x, z: v.root.position.z } : null; });
  const p0 = await heroPos();
  await page.mouse.click(vp.width * 0.72, vp.height * 0.3, { button: 'right' });
  await page.waitForTimeout(2500);
  const p1 = await heroPos();
  const moved = p0 && p1 ? Math.hypot(p1.x - p0.x, p1.z - p0.z) : 0;
  await page.screenshot({ path: `${out}/${name}.png` });
  const ok = moved > 3 && errors.length === 0;
  failed ||= !ok;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: hero moved ${moved.toFixed(1)}u, errors=${errors.length}${errors.length ? ' ' + errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
