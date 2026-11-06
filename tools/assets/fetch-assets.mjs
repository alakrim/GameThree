#!/usr/bin/env node
// Reproducible asset pipeline. Downloads CC0 source assets, optimizes them for the web, writes CREDITS.md.
//   node tools/assets/fetch-assets.mjs            (skips assets already present)
//   node tools/assets/fetch-assets.mjs --force
// Sources: ambientCG (CC0) PBR textures, Poly Haven (CC0) models + HDRI.
import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'packages/client/public/assets');
const TMP = join(ROOT, 'node_modules/.cache/lumen-assets');
const FORCE = process.argv.includes('--force');

// name -> ambientCG id. Kept small (1K) for web; normal/roughness downsampled where detail is not visible.
const TEXTURES = {
  grass: 'Grass004', forest: 'Ground037', rock: 'Rock020', snow: 'Snow006', road: 'Gravel043',
  cobble: 'PavingStones070', slate: 'Rock051', bark: 'Bark014', timber: 'Wood062',
  steel: 'Metal032', leather: 'Leather037', cloth: 'Fabric030',
};
// Poly Haven model id -> simplify ratio (1 = keep) and optional low-detail LOD ratio (writes <id>_lod.glb).
const MODELS = {
  rock_moss_set_01: [0.12, 0.012], rock_moss_set_02: [0.12, 0.012], rock_07: [0.3, 0.025], rock_09: [0.3, 0.025],
  dead_tree_trunk: [0.06], stone_fire_pit: [1], kite_shield: [0.6], antique_estoc: [1], ornate_war_hammer: [1],
};
const HDRI = 'kloofendal_48d_partly_cloudy_puresky';

const credits = [];
const get = async (url) => {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()); }
    catch (e) { if (i === 3) throw e; await new Promise((s) => setTimeout(s, 2000 * 2 ** i)); }
  }
};
const mk = (p) => mkdirSync(p, { recursive: true });

async function textures() {
  for (const [name, id] of Object.entries(TEXTURES)) {
    const dir = join(OUT, 'textures', name);
    credits.push(`| textures/${name} | ambientCG \`${id}\` | https://ambientcg.com/view?id=${id} | CC0 1.0 |`);
    if (existsSync(join(dir, 'color.jpg')) && !FORCE) continue;
    console.log(`texture ${name} <- ${id}`);
    const files = unzipSync(new Uint8Array(await get(`https://ambientcg.com/get?file=${id}_1K-JPG.zip`)));
    const pick = (suffix) => { const k = Object.keys(files).find((f) => f.endsWith(`_${suffix}.jpg`)); return k ? Buffer.from(files[k]) : null; };
    mk(dir);
    await sharp(pick('Color')).resize(1024, 1024).jpeg({ quality: 82, mozjpeg: true }).toFile(join(dir, 'color.jpg'));
    await sharp(pick('NormalGL')).resize(1024, 1024).jpeg({ quality: 88, mozjpeg: true }).toFile(join(dir, 'normal.jpg'));
    await sharp(pick('Roughness')).resize(512, 512).greyscale().jpeg({ quality: 80, mozjpeg: true }).toFile(join(dir, 'rough.jpg'));
  }
}

async function models() {
  const cli = join(ROOT, 'node_modules/.bin/gltf-transform');
  for (const [id, [ratio, lod]] of Object.entries(MODELS)) {
    const out = join(OUT, 'models', `${id}.glb`);
    credits.push(`| models/${id}${lod ? ' (+ _lod)' : ''}.glb | Poly Haven \`${id}\` | https://polyhaven.com/a/${id} | CC0 1.0 |`);
    if (existsSync(out) && (!lod || existsSync(join(OUT, 'models', `${id}_lod.glb`))) && !FORCE) continue;
    console.log(`model ${id} (simplify ${ratio}${lod ? `, lod ${lod}` : ''})`);
    const meta = JSON.parse((await get(`https://api.polyhaven.com/files/${id}`)).toString());
    const g = meta.gltf['1k'].gltf;
    const src = join(TMP, id); rmSync(src, { recursive: true, force: true }); mk(src);
    writeFileSync(join(src, `${id}.gltf`), await get(g.url));
    for (const [rel, f] of Object.entries(g.include ?? {})) { mk(dirname(join(src, rel))); writeFileSync(join(src, rel), await get(f.url)); }
    mk(dirname(out));
    const run = (dst, r, size) => {
      const args = ['optimize', join(src, `${id}.gltf`), dst, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(size)];
      if (r < 1) args.push('--simplify-ratio', String(r), '--simplify-error', r < 0.05 ? '0.02' : '0.002'); else args.push('--simplify', 'false');
      execFileSync(cli, args, { stdio: 'ignore' });
    };
    run(out, ratio, 1024);
    if (lod) run(join(OUT, 'models', `${id}_lod.glb`), lod, 256); // distant / small / low-tier variant
  }
}

async function hdri() {
  const dir = join(OUT, 'hdri'); mk(dir);
  credits.push(`| hdri/sky_1k.hdr, hdri/sky_bg.jpg | Poly Haven \`${HDRI}\` | https://polyhaven.com/a/${HDRI} | CC0 1.0 |`);
  if (existsSync(join(dir, 'sky_bg.jpg')) && !FORCE) return;
  console.log(`hdri ${HDRI}`);
  const meta = JSON.parse((await get(`https://api.polyhaven.com/files/${HDRI}`)).toString());
  writeFileSync(join(dir, 'sky_1k.hdr'), await get(meta.hdri['1k'].hdr.url)); // image-based lighting
  // Background: tonemapped 8K JPG reduced to 4K for a sharp sky without HDR decode cost.
  await sharp(await get(meta.tonemapped.url)).resize(4096, 2048).jpeg({ quality: 80, mozjpeg: true }).toFile(join(dir, 'sky_bg.jpg'));
}

mk(OUT); mk(TMP);
await textures(); await models(); await hdri();
writeFileSync(join(OUT, 'CREDITS.md'), `# Asset credits\n\nAll third-party assets are CC0 1.0 (public domain). Generated by \`tools/assets/fetch-assets.mjs\`.\n\n| Path | Source | URL | License |\n|---|---|---|---|\n${credits.join('\n')}\n`);
console.log('assets ready');
