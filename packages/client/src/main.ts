import * as THREE from 'three';
import { createMap, NavGrid, HEROES, DEFAULT_HERO, TICK_RATE, World, BULWARKS, BULWARK_TYPES, ECON, SENDS, WAVES, ITEMS, REPAIR, investedIn, itemStats, type Snapshot, type GameEvent, type EntitySnapshot, type BulwarkType, type ItemId } from '@lumen/shared';
import { manager } from './assets.js';
import { setupSky } from './render/sky.js';
import { buildTerrain, toWorld } from './render/terrain.js';
import { buildFoliage } from './render/foliage.js';
import { buildProps } from './render/props.js';
import { updateFire } from './render/fire.js';
import { preloadCharacterAssets } from './render/character.js';
import { UnitView } from './render/units.js';
import { StructureView } from './render/structures.js';
import { Vfx, ProjectileView } from './render/vfx.js';
import { ThirdPersonCamera } from './render/camera.js';
import { createComposer } from './render/post.js';
import { teamColor, PALETTE } from './render/palette.js';
import { detectTier, qualityFor, type Tier } from './render/quality.js';
import { Interpolator, type InterpEntity } from './net/interp.js';
import { Predictor } from './net/prediction.js';
import { LocalTransport, WsTransport, type Transport, type Welcome } from './net/transport.js';
import { Input } from './input/input.js';
import { Hud, LoadingScreen, markerColors, pickHero } from './ui/hud.js';
import { sfx } from './audio/sfx.js';
import { BulwarkView, WolfView, TrapView } from './render/tdviews.js';
import { ShopHud } from './ui/shop.js';
import type { ActionAnim } from './render/character.js';
import type { SfxName } from './audio/sfx.js';

/** Per-hero presentation: which body animation and sound each slot uses ([basic, Q, E, R]). */
const HERO_FX: Record<string, { anim: ActionAnim[]; sound: [SfxName, number][] }> = {
  hrodvar: { anim: ['attack', 'attack', 'attack', 'slam'], sound: [['swing', 1], ['dash', 1], ['swing', 0.8], ['horn', 1]] },
  sigrun: { anim: ['shoot', 'cast', 'attack', 'cast'], sound: [['frostBolt', 1], ['cast', 1], ['dash', 1.2], ['cast', 0.8]] },
  hilde: { anim: ['bow', 'bow', 'cast', 'bow'], sound: [['bowShot', 1], ['bowShot', 0.8], ['hammer', 0.7], ['bowShot', 0.65]] },
  brynna: { anim: ['throw', 'throw', 'spin', 'throw'], sound: [['chainThrow', 1.15], ['chainThrow', 1], ['whirl', 1], ['chainThrow', 0.75]] },
  halla: { anim: ['cast', 'cast', 'cast', 'slam'], sound: [['cast', 1.5], ['cast', 1.2], ['ward', 1], ['heal', 0.8]] },
};
import { buildBulwarkGhost } from './render/bulwarks.js';
import { TdHud } from './ui/td.js';

const params = new URLSearchParams(location.search);
let tier: Tier = detectTier();
const q = qualityFor(tier);
const loading = new LoadingScreen();
manager.onProgress = (_u, done, total) => loading.progress((done / total) * 0.9);

// ---- Renderer ---------------------------------------------------------------------------------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, q.dprCap));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = q.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
const scene = new THREE.Scene();

async function boot() {
  const map = createMap(1337);
  const nav = new NavGrid(map);
  const [sky] = await Promise.all([setupSky(renderer, scene), preloadCharacterAssets()]);
  scene.fog = new THREE.FogExp2(sky.horizon, 0.0042);

  const sun = new THREE.DirectionalLight(sky.sunColor, 3.2);
  sun.castShadow = q.shadows;
  if (q.shadows) {
    sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 220 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  }
  scene.add(sun, sun.target);

  const terrain = buildTerrain(map, q);
  scene.add(terrain.mesh, terrain.water);
  const foliage = buildFoliage(map, q);
  scene.add(foliage.group);
  const props = await buildProps(map, q);
  scene.add(props.group);
  const groundAtWorld = (wx: number, wz: number) => terrain.heightAt(wx, -wz);
  const vfx = new Vfx(groundAtWorld, q.tier === 'low' ? 1 : 2);
  scene.add(vfx.group);

  const cam = new ThirdPersonCamera(groundAtWorld);
  let composer = q.tier !== 'low' ? createComposer(renderer, scene, cam.camera, q.bloom) : null;
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); composer?.setSize(innerWidth, innerHeight); cam.resize(innerWidth, innerHeight); vfx.setViewportHeight(innerHeight * renderer.getPixelRatio()); };
  addEventListener('resize', resize); resize();
  await renderer.compileAsync(scene, cam.camera); // avoid first-frame shader hitches
  loading.progress(1); loading.done();

  // ---- Hero selection -------------------------------------------------------------------------
  let stored: string | null = null;
  try { stored = localStorage.getItem('lumen.hero'); } catch { /* private mode */ }
  const heroId = params.get('hero') && HEROES[params.get('hero')!] ? params.get('hero')! : await pickHero(stored ?? DEFAULT_HERO);
  const heroDef = HEROES[heroId]!;

  // ---- Net + prediction -----------------------------------------------------------------------
  const serverUrl = params.get('server');
  const transport: Transport = serverUrl ? new WsTransport(serverUrl, heroId) : new LocalTransport(heroId);
  const interp = new Interpolator();
  let me: Welcome | null = null, status = 'connecting', lastTick = 0;
  let mine: EntitySnapshot | undefined;
  const predictor = new Predictor(nav, (c) => transport.send(c));
  const input = new Input(canvas, cam);
  const cdTotals = [heroDef.attack.cooldown, ...heroDef.abilities.map((a) => a.cooldown)];
  const localCdUntil = [0, 0, 0, 0];
  let facingOverride = { aim: 0, until: 0 };
  const held = [false, false, false, false];
  let groundPreview: THREE.Mesh | null = null;

  const hud = new Hud(document.getElementById('hud')!, input.touch, heroDef, { view: () => cam.toggleView(), act: (s, ph) => onAct(s, ph) });
  /** Ability cooldowns shortened by item CDR (mirrors the server so the local cooldown gate doesn't over-block). */
  const cdTotalsNow = () => { const cdr = itemStats(mine?.it ?? []).cdr; return cdTotals.map((c, i) => (i === 0 ? c : c * (1 - cdr))); };
  input.onAct = (s, ph) => onAct(s, ph);

  // ---- Bulwarks: build mode, war table, interaction ----------------------------------------------
  let buildOpen = false, buildType: BulwarkType = 'arrow';
  const ghostOk = new THREE.MeshBasicMaterial({ color: 0x7fe08a, transparent: true, opacity: 0.45, depthWrite: false });
  const ghostBad = new THREE.MeshBasicMaterial({ color: PALETTE.hostile, transparent: true, opacity: 0.45, depthWrite: false });
  const ghosts = new Map<string, THREE.Group>();
  let ghost: THREE.Group | null = null;
  let ghostSite: { x: number; y: number; ok: boolean; why: string | null } | null = null;
  const rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf2d48a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  rangeRing.visible = false; scene.add(rangeRing);
  let focus: BulwarkView | null = null;
  const setBuild = (open: boolean, type = buildType) => {
    buildOpen = open; buildType = type; td.setBuild(open, type);
    if (ghost) { scene.remove(ghost); ghost = null; }
    if (open) {
      const key = `${type}`;
      if (!ghosts.has(key)) ghosts.set(key, buildBulwarkGhost(type, ghostOk));
      ghost = ghosts.get(key)!; scene.add(ghost);
    }
  };
  const placeGhost = () => {
    if (!buildOpen || !ghostSite) return;
    if (!ghostSite.ok) { td.toast(ghostSite.why ?? 'cannot build here', 'bad'); sfx.play('uiClick', undefined, { pitch: 0.6 }); return; }
    transport.send({ type: 'build', kind: buildType, x: ghostSite.x, y: ghostSite.y });
  };
  const toggleTable = (open: boolean) => { td.setTable(open); if (open) { setBuild(false); document.exitPointerLock?.(); } };
  const canShop = () => !!mine && (!!((mine.st ?? 0) & 4) || Math.hypot(mine.x - map.bases[me!.team].pos.x, mine.y - map.bases[me!.team].pos.y) < map.bases[me!.team].radius);
  const toggleShop = (open: boolean) => { shop.setOpen(open); if (open) { setBuild(false); td.setTable(false); document.exitPointerLock?.(); } };
  const recall = () => { transport.send({ type: 'recall' }); };
  /** Repair the structure under the reticle (or stop repairing). */
  const repair = () => {
    if (mine && (mine.st ?? 0) & 1024) { transport.send({ type: 'repair', id: 0 }); return; }
    if (!focus) { td.toast('Look at one of your structures to repair it', 'bad'); return; }
    transport.send({ type: 'repair', id: focus.id });
  };
  const td = new TdHud(document.getElementById('hud')!, input.touch, {
    build: (t) => setBuild(true, t),
    closeBuild: () => setBuild(false),
    send: (unit, lane) => { transport.send({ type: 'send', unit, lane }); sfx.play('uiClick'); },
    toggleTable,
    place: placeGhost,
    toggleBuild: () => setBuild(!buildOpen),
    shop: () => toggleShop(!shop.open),
    recall, repair,
  });
  const shop = new ShopHud(document.getElementById('hud')!, {
    buy: (item) => transport.send({ type: 'buy', item }),
    sell: (slot) => transport.send({ type: 'sellItem', slot }),
    close: () => toggleShop(false),
  });
  let boardOpen = false;
  input.onPrimary = () => { if (!buildOpen) return false; placeGhost(); return true; };
  input.onCancel = () => { if (buildOpen) setBuild(false); };
  input.onKeyUp = (code) => { if (code === 'Tab') { boardOpen = false; hud.setBoard(false); } };
  input.onKey = (code) => {
    if (code === 'KeyB') setBuild(!buildOpen);
    else if (code.startsWith('Digit')) setBuild(true, BULWARK_TYPES[Number(code.slice(5)) - 1] ?? 'arrow');
    else if (code === 'KeyG') toggleTable(!td.tableOpen);
    else if (code === 'KeyP') toggleShop(!shop.open);
    else if (code === 'KeyH') recall();
    else if (code === 'KeyF') repair();
    else if (code === 'Tab') boardOpen = true;
    else if (code === 'Escape') { setBuild(false); td.setTable(false); toggleShop(false); }
    else if ((code === 'KeyU' || code === 'KeyX') && focus) transport.send({ type: code === 'KeyU' ? 'upgrade' : 'sell', id: focus.id });
  };
  let unlocked = false;
  input.onGesture = () => { if (!unlocked) { unlocked = true; sfx.unlock(); sfx.startAmbience(); } };

  let markers: { p: { x: number; y: number }; color: string; label: string }[] = [];
  transport.onStatus = (s) => { status = s; };
  transport.onWelcome = (w) => {
    me = w;
    cam.yaw = w.team === 0 ? -Math.PI / 4 : (3 * Math.PI) / 4; // face the valley from the fort
    const ownFort = map.bases[w.team].pos, enemyFort = map.bases[w.team === 0 ? 1 : 0].pos;
    markers = [{ p: ownFort, color: markerColors.ally(w.team), label: 'Your fort' }, { p: enemyFort, color: markerColors.enemy, label: 'Enemy fort' }];
    hud.setMarkers(markers.map((m) => ({ yaw: 0, color: m.color, label: m.label })));
  };
  const eventQueue: { t: number; ev: GameEvent }[] = [];
  /** Structures block movement: mirror them into the client nav grid so prediction matches the server. */
  const navBlocks = new Map<number, number[]>();
  let waveNo = 0, nextWave = 0, matchSec = 0;
  transport.onSnapshot = (s: Snapshot) => {
    interp.push(s, performance.now()); lastTick = s.tick;
    waveNo = s.wv ?? waveNo; nextWave = s.nw ?? nextWave;
    const seen = new Set<number>();
    for (const e of s.ents) {
      if (e.k !== 5) continue;
      seen.add(e.id);
      if (!navBlocks.has(e.id)) {
        const cells = BULWARKS[BULWARK_TYPES[e.b ?? 0]!].blocks ? nav.footprint(e.x, e.y) : [];
        nav.block(cells, true); navBlocks.set(e.id, cells);
      }
    }
    for (const [id, cells] of navBlocks) if (!seen.has(id)) { nav.block(cells, false); navBlocks.delete(id); }
    for (const ev of s.ev ?? []) eventQueue.push({ t: (s.tick * 1000) / TICK_RATE, ev });
    mine = me ? s.ents.find((e) => e.o === me!.playerId) : undefined;
    matchSec = s.mt ?? matchSec;
    if (mine) predictor.reconcile({ x: mine.x, y: mine.y }, mine.sq ?? 0, mine.sm ?? 1, !!((mine.st ?? 0) & (1 | 4 | 32 | 64 | 512)));
  };

  // ---- Aiming ---------------------------------------------------------------------------------
  /** March the camera's centre ray over the terrain; returns the sim-space point under the reticle. */
  const reticleGround = (maxDist = 70): { x: number; y: number } => {
    const o = cam.camera.position, d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.aimQuaternion);
    for (let t = 1; t < maxDist; t += 0.5) {
      const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
      if (py <= groundAtWorld(px, pz)) return { x: px, y: -pz };
    }
    return { x: o.x + d.x * maxDist, y: -(o.z + d.z * maxDist) };
  };
  const aimFrom = (hx: number, hy: number) => {
    const p = reticleGround();
    const dx = p.x - hx, dy = p.y - hy;
    if (Math.hypot(dx, dy) < 2.5) { const { fwd } = cam.basis(); return { aim: Math.atan2(fwd[1], fwd[0]), p }; }
    return { aim: Math.atan2(dy, dx), p };
  };

  function onAct(slot: number, phase: 'down' | 'up') {
    held[slot] = phase === 'down';
    const ab = slot > 0 ? heroDef.abilities[slot - 1]! : null;
    if (ab?.kind === 'groundAoe' || ab?.kind === 'trap') { // hold to aim, release to cast
      if (phase === 'up') { groundPreview?.removeFromParent(); groundPreview = null; fire(slot); }
      return;
    }
    if (phase === 'down') fire(slot);
  }

  function fire(slot: number): boolean {
    const pos = predictor.pos;
    if (!pos || !mine || (mine.st ?? 0) & (1 | 4)) return false;
    const now = performance.now();
    const serverCd = (mine.cd?.[slot] ?? 0) / 10;
    if (now < localCdUntil[slot]! || serverCd > 0.15) return false;
    const { aim, p } = aimFrom(pos.x, pos.y);
    transport.send({ type: 'act', slot, aim, tx: p.x, ty: p.y });
    localCdUntil[slot] = now + cdTotalsNow()[slot]! * 1000;
    const windup = slot === 0 ? heroDef.attack.windup : heroDef.abilities[slot - 1]!.windup;
    facingOverride = { aim, until: now + windup * 1000 + 250 };
    playActionLocal(slot, aim, pos.x, pos.y);
    return true;
  }

  // ---- Entity views ---------------------------------------------------------------------------
  const units = new Map<number, UnitView>();
  const structures = new Map<number, StructureView>();
  const collapsing: { collapse(dt: number): boolean; root: THREE.Object3D }[] = [];
  const bulwarkViews = new Map<number, BulwarkView>();
  const wolves = new Map<number, WolfView>();
  const projectiles = new Map<number, ProjectileView>();
  const traps = new Map<number, TrapView>();
  /** Per-unit repair cadence (hammer anim + sparks + sound). */
  const repairT = new Map<number, number>();
  const heroByOwner = (owner: string | undefined) => { if (!owner) return undefined; for (const [id, e] of lastSeen) if (e.k === 0 && e.o === owner) return units.get(id); return undefined; };
  const lastSeen = new Map<number, InterpEntity>();
  const worldPos = (id: number) => { const e = lastSeen.get(id); return e ? toWorld(e.x, e.y, terrain.heightAt(e.x, e.y)) : null; };

  const actionAnim = (heroKey: string | undefined, slot: number): ActionAnim => (heroKey ? HERO_FX[heroKey]?.anim[slot] : undefined) ?? 'attack';

  function playActionLocal(slot: number, aim: number, x: number, y: number) {
    const v = [...units.values()].find((u) => u.isLocal);
    const kind = actionAnim(heroId, slot);
    v?.character.play(kind, kind === 'bow' ? 0.75 : kind === 'spin' ? 0.5 : slot === 0 ? Math.max(0.4, heroDef.attack.cooldown * 0.6) : 0.6);
    const p = toWorld(x, y, terrain.heightAt(x, y));
    soundFor(heroId, slot, p);
    if (kind === 'attack' && (slot === 0 || heroDef.abilities[slot - 1]!.kind === 'cone')) {
      setTimeout(() => vfx.slash(p, aim, slot === 0 ? 0xfff2d8 : 0xffc27a, slot === 0 ? 2.6 : 3.8), (slot === 0 ? heroDef.attack.windup : heroDef.abilities[slot - 1]!.windup) * 1000);
    }
  }

  function soundFor(hid: string | undefined, slot: number, at: THREE.Vector3) {
    const fx = hid ? HERO_FX[hid]?.sound[slot] : undefined;
    if (!fx) { sfx.play('swing', at, { volume: 0.5, pitch: 1.2 }); return; }
    sfx.play(fx[0], at, { pitch: fx[1] });
  }

  function handleEvent(ev: GameEvent) {
    const isMe = (id: number) => !!mine && id === mine.id;
    switch (ev.e) {
      case 'act': {
        const src = lastSeen.get(ev.s);
        if (!src || isMe(ev.s)) return; // own actions were played immediately on input
        const p = worldPos(ev.s)!;
        if (src.k === 2) { sfx.play('towerShot', p.clone().setY(p.y + 8)); return; }
        if (src.k === 5) {
          const bv = bulwarkViews.get(ev.s); bv?.aim(ev.y);
          sfx.play(bv?.type === 'fire' ? 'towerShot' : 'swing', p.clone().setY(p.y + 3), { pitch: bv?.type === 'fire' ? 0.8 : 1.7, volume: 0.6 });
          return;
        }
        const u = units.get(ev.s);
        const kind = actionAnim(src.h, ev.a);
        u?.character.play(kind, kind === 'bow' ? 0.75 : kind === 'spin' ? 0.5 : 0.55);
        soundFor(src.h, ev.a, p);
        if (kind === 'attack' && src.k === 0) {
          const def = HEROES[src.h!]!;
          const big = ev.a > 0;
          const delay = ev.a === 0 ? def.attack.windup : def.abilities[ev.a - 1]!.windup;
          setTimeout(() => vfx.slash(p, ev.y, big ? 0xffc27a : 0xfff2d8, big ? 3.8 : 2.6), delay * 1000);
        }
        break;
      }
      case 'hit': {
        const p = worldPos(ev.d); if (!p) return;
        const tgt = lastSeen.get(ev.d);
        const chest = p.clone().setY(p.y + (tgt?.k === 2 ? 4 : 1.2));
        vfx.impact(chest, ev.k === 2 ? 0xffa040 : ev.k === 1 ? 0xffd27a : 0xfff0d0, ev.k === 1);
        units.get(ev.d)?.character.hit();
        sfx.play(tgt?.k === 0 || tgt?.k === 2 ? 'hitMetal' : 'hit', chest, { volume: 0.8 });
        const mineSrc = isMe(ev.s), mineTgt = isMe(ev.d);
        if (mineSrc || mineTgt || (tgt?.k === 0)) hud.damage(chest.x, chest.y + 1, chest.z, ev.n, mineTgt ? 'taken' : ev.k === 1 ? 'abl' : '');
        if (mineTgt && ev.n >= 90) cam.shake(Math.min(0.5, ev.n / 400));
        break;
      }
      case 'die': {
        const p = worldPos(ev.d); if (!p) return;
        const tgt = lastSeen.get(ev.d);
        if (tgt?.k === 2) { const sv = structures.get(ev.d); if (sv) { collapsing.push(sv); structures.delete(ev.d); } vfx.dust(p.clone().setY(p.y + 2), 80); sfx.play('explosion', p); if (p.distanceTo(heroWorld) < 30) cam.shake(0.4); }
        else if (tgt?.k === 4) { vfx.blast(p.x, p.z, 10, 'fire'); sfx.play('explosion', p, { volume: 1 }); }
        else if (tgt?.k === 6) vfx.dust(p.clone().setY(p.y + 0.2), 8, 0x9a8f7c);
        else { vfx.dust(p.clone().setY(p.y + 0.5), 14, 0x6b6458); if (tgt?.k === 0) sfx.play('death', p); }
        if (isMe(ev.d)) hud.message('You have fallen', 'Respawning at your fort');
        break;
      }
      case 'lvl': { const p = worldPos(ev.s); if (p) { vfx.levelUp(p); if (isMe(ev.s)) sfx.play('levelUp'); } break; }
      case 'tele': {
        const src = lastSeen.get(ev.s);
        const hostile = !!me && src?.t !== me.team;
        vfx.telegraph(ev.x, -ev.y, ev.r, ev.d, hostile ? PALETTE.hostile : teamColor(me?.team ?? 0));
        break;
      }
      case 'aoe': {
        const at = toWorld(ev.x, ev.y, terrain.heightAt(ev.x, ev.y));
        if (ev.fx === 'winter_rain') { vfx.arrowVolley(ev.x, -ev.y, ev.r); sfx.play('arrowRain', at, { volume: 0.8 }); break; }
        if (ev.fx === 'dawnfire_ring') { vfx.dawn(ev.x, -ev.y, ev.r, 3); sfx.play('heal', at, { pitch: 0.7 }); sfx.play('horn', at, { volume: 0.4, pitch: 1.3 }); break; }
        if (ev.fx === 'chain_whirl') { vfx.whirl(at, ev.r); break; }
        const kind = ev.fx === 'glacial_burst' ? 'frost' : ev.fx === 'ember' ? 'fire' : 'horn';
        vfx.blast(ev.x, -ev.y, ev.r, kind);
        sfx.play(kind === 'frost' ? 'explosion' : 'hit', at, { pitch: kind === 'frost' ? 1.2 : 0.7 });
        break;
      }
      case 'pop': {
        const p = toWorld(ev.x, ev.y, terrain.heightAt(ev.x, ev.y) + 1.2);
        if (ev.fx === 'ice_lance' || ev.fx === 'sigrun_basic') { vfx.impact(p, 0xaee6ff, ev.fx === 'ice_lance'); sfx.play('iceShatter', p, { volume: ev.fx === 'ice_lance' ? 1 : 0.5 }); }
        else if (ev.fx === 'lantern_beam' || ev.fx === 'halla_basic' || ev.fx === 'thread_of_warmth') vfx.impact(p, 0xffd27a, ev.fx === 'lantern_beam');
        else if (ev.fx === 'hooked_reel' || ev.fx === 'last_link') vfx.sparks(p);
        else if (ev.fx === 'split_shot' || ev.fx === 'hilde_basic') vfx.impact(p, 0xe8eef5, false);
        break;
      }
      case 'heal': {
        const p = worldPos(ev.d); if (!p) return;
        if (ev.n >= 8) vfx.heal(p, ev.n > 80);
        const tgt = lastSeen.get(ev.d);
        if (ev.n >= 5 && (isMe(ev.d) || isMe(ev.s) || (tgt && me && tgt.t === me.team && tgt.k === 0))) hud.damage(p.x, p.y + 2.1, p.z, `+${ev.n}`, 'heal');
        if (ev.n > 60 && (isMe(ev.d) || isMe(ev.s))) sfx.play('heal', p, { volume: 0.6 });
        break;
      }
      case 'shield': {
        const p = worldPos(ev.d); if (!p) return;
        sfx.play('ward', p);
        hud.damage(p.x, p.y + 2.2, p.z, `◈ ${ev.n}`, 'shield');
        break;
      }
      case 'hook': {
        const from = () => { const u = units.get(ev.s); return u ? u.character.handWorld('R') : null; };
        const to = () => { const u = units.get(ev.d); return u ? u.root.position.clone().setY(u.root.position.y + 1.1) : worldPos(ev.d); };
        vfx.chain(from, to, ev.r ? 0.3 : 0.55, ev.r ? 16 : 28);
        const p = worldPos(ev.d); if (p) { sfx.play(ev.r ? 'chainThrow' : 'chainCatch', p, { volume: ev.r ? 0.5 : 1 }); vfx.sparks(p.clone().setY(p.y + 1.1)); }
        if (!ev.r && isMe(ev.d)) cam.shake(0.45);
        break;
      }
      case 'snare': {
        const p = worldPos(ev.d) ?? worldPos(ev.s); if (!p) return;
        vfx.snare(p); sfx.play('snare', p);
        if (isMe(ev.d)) hud.damage(p.x, p.y + 2.3, p.z, 'Snared', 'taken');
        break;
      }
      case 'imm': { const p = worldPos(ev.d); if (p) hud.damage(p.x, p.y + 2.4, p.z, 'Immune', 'info'); break; }
      case 'push': break; // whirl visuals come from the matching 'aoe'
      case 'buy': {
        if (!isMe(ev.s)) return;
        const d = ITEMS[ev.i as ItemId];
        td.toast(ev.sold ? `Sold ${d?.name ?? ev.i}` : `Equipped ${d?.name ?? ev.i}`, 'gold');
        sfx.play('coin');
        const p = worldPos(ev.s); if (p) vfx.coins(p.clone().setY(p.y + 1.6), 10);
        break;
      }
      case 'kill': {
        const killer = lastSeen.get(ev.s), victim = lastSeen.get(ev.d);
        if (!victim) return;
        const label = (e: EntitySnapshot | undefined) => e ? (e.k === 0 ? HEROES[e.h ?? '']?.name ?? 'Hero' : e.k === 2 ? 'Tower' : e.k === 5 ? 'Bulwark' : 'Warband') : 'The valley';
        const ally = (e: EntitySnapshot) => !!me && e.t === me.team;
        hud.killFeed(killer && killer.k === 0 ? { name: label(killer) + (isMe(ev.s) ? ' (you)' : ''), ally: ally(killer) } : killer ? { name: label(killer), ally: ally(killer) } : null,
          { name: label(victim) + (isMe(ev.d) ? ' (you)' : ''), ally: ally(victim) }, ev.a.length);
        if (isMe(ev.s) || ev.a.includes(mine?.id ?? -1)) { sfx.play('kill'); td.showBanner(isMe(ev.s) ? 'Foe slain' : 'Assist', `${label(victim)} has fallen`); }
        else if (isMe(ev.d)) sfx.play('kill', undefined, { pitch: 0.7 });
        break;
      }
      case 'recall': {
        const p = worldPos(ev.s); if (!p) return;
        if (ev.done) { setTimeout(() => { const q = worldPos(ev.s); if (q) vfx.recall(q); }, 120); vfx.recall(p); }
        else sfx.play('recall', p, { volume: isMe(ev.s) ? 0.9 : 0.5 });
        break;
      }
      case 'spawn': if (isMe(ev.s)) hud.clearMessage(); break;
      case 'win': {
        const won = !!me && ev.t === me.team;
        hud.message(won ? 'Victory' : 'Defeat', won ? 'The enemy Heartstone is shattered' : 'Your Heartstone has fallen', won ? 'victory' : 'defeat');
        sfx.play(won ? 'victory' : 'defeat');
        break;
      }
      case 'build': {
        const p = toWorld(ev.x, ev.y, terrain.heightAt(ev.x, ev.y));
        vfx.dust(p.clone().setY(p.y + 0.4), ev.lv ? 10 : 22, 0x9a8f7c);
        sfx.play('hit', p, { pitch: ev.lv ? 1.3 : 0.6, volume: 0.8 });
        if (ev.lv) vfx.levelUp(p);
        break;
      }
      case 'deny': if (isMe(ev.s)) { td.toast(ev.why, 'bad'); sfx.play('uiClick', undefined, { pitch: 0.6 }); } break;
      case 'wave': td.showBanner(`Wave ${ev.n}`, ev.n >= WAVES.bossFirst && ev.n % WAVES.bossEvery === 0 ? 'A Rimetroll leads the charge' : 'The warbands march'); sfx.play('horn', undefined, { volume: 0.5 }); break;
      case 'leak': {
        const own = !!me && ev.t === me.team;
        td.toast(own ? `Leak! Heartstone −${ev.n}` : `Enemy leak −${ev.n}`, own ? 'bad' : 'good');
        const hp = map.bases[ev.t].pos; const p = toWorld(hp.x, hp.y, terrain.heightAt(hp.x, hp.y) + 3);
        vfx.impact(p, own ? PALETTE.hostile : 0xf2d48a, true);
        if (own) sfx.play('explosion', undefined, { volume: 0.35, pitch: 1.4 });
        break;
      }
      case 'send': {
        const src = lastSeen.get(ev.s);
        if (src && me && src.t === me.team) td.toast(`${isMe(ev.s) ? 'You' : 'An ally'} sent ${SENDS[ev.u as keyof typeof SENDS]?.name ?? ev.u} → ${ev.l}`, 'good');
        break;
      }
      case 'gold': if (isMe(ev.s)) { const p = worldPos(ev.d); if (p) { hud.damage(p.x, p.y + 2.2, p.z, ev.n, 'heal'); vfx.coins(p.clone().setY(p.y + 1.5)); } } break;
      case 'lob': {
        const bv = bulwarkViews.get(ev.s);
        const from = bv ? bv.muzzle : worldPos(ev.s)?.setY(3);
        if (from) vfx.lob(from, toWorld(ev.x, ev.y, terrain.heightAt(ev.x, ev.y) + 0.3), ev.d);
        break;
      }
      case 'reset': hud.clearMessage(); for (const v of bulwarkViews.values()) scene.remove(v.root); bulwarkViews.clear(); for (const sv of structures.values()) scene.remove(sv.root); structures.clear(); for (const tv of traps.values()) scene.remove(tv.root); traps.clear(); break;
    }
  }

  // ---- Loop -----------------------------------------------------------------------------------
  const clock = new THREE.Clock();
  let fpsAcc = 0, fpsFrames = 0, fps = 60, frameMs = 16, slow = 0, stepT = 0;
  const heroWorld = new THREE.Vector3();
  const proj = new THREE.Vector3();
  const project = (x: number, y: number, z: number) => {
    proj.set(x, y, z).project(cam.camera);
    return { x: (proj.x * 0.5 + 0.5) * innerWidth, y: (-proj.y * 0.5 + 0.5) * innerHeight, visible: proj.z < 1 };
  };

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t0 = performance.now();
    renderer.info.reset();
    transport.update(dt);
    const [mx, my] = input.movement();
    predictor.step(dt, mx, my);
    if (held[0]) fire(0); // hold to keep attacking

    const now = performance.now();
    const rt = interp.renderTime(now);
    while (eventQueue.length && eventQueue[0]!.t <= rt + 1) handleEvent(eventQueue.shift()!.ev);
    if (eventQueue.length > 400) eventQueue.splice(0, eventQueue.length - 400);

    const ents = interp.sample(now);
    for (const [id, v] of units) if (!ents.has(id)) { scene.remove(v.root); units.delete(id); }
    for (const [id, v] of projectiles) if (!ents.has(id)) { scene.remove(v.root); projectiles.delete(id); }
    for (const [id, v] of structures) if (!ents.has(id)) { scene.remove(v.root); structures.delete(id); }
    for (const [id, v] of bulwarkViews) if (!ents.has(id)) { collapsing.push(v); bulwarkViews.delete(id); }
    for (const [id, v] of wolves) if (!ents.has(id)) { scene.remove(v.root); wolves.delete(id); }
    for (const [id, v] of traps) if (!ents.has(id)) { scene.remove(v.root); traps.delete(id); }
    lastSeen.clear();
    for (const e of ents.values()) {
      lastSeen.set(e.id, e);
      const ally = me ? e.t === me.team : e.t === 0;
      if (e.k === 3) {
        let pv = projectiles.get(e.id);
        if (!pv) {
          pv = new ProjectileView(e.fx ?? '', vfx); projectiles.set(e.id, pv); scene.add(pv.root);
          if (e.fx === 'hooked_reel' || e.fx === 'last_link') {
            // Chain paid out from the caster's hand to the flying hook.
            const owner = e.o, view = pv;
            vfx.chain(() => heroByOwner(owner)?.character.handWorld('R') ?? null, () => (projectiles.get(e.id) === view ? view.root.position : null), 1.0);
          }
        }
        pv.place(toWorld(e.x, e.y, terrain.heightAt(e.x, e.y) + (e.fx === 'tower_bolt' ? 0 : 1.25)), e.f, dt);
        if (e.fx === 'tower_bolt') pv.root.position.y = Math.max(pv.root.position.y, terrain.heightAt(e.x, e.y) + 1.4);
        continue;
      }
      if (e.k === 6) {
        let tv = traps.get(e.id);
        if (!tv) { tv = new TrapView(e.id, e.t, ally, HEROES.hilde!.abilities[1].radius ?? 1); traps.set(e.id, tv); scene.add(tv.root); sfx.play('hammer', toWorld(e.x, e.y, terrain.heightAt(e.x, e.y)), { pitch: 0.7, volume: 0.6 }); }
        tv.place(e.x, e.y, terrain.heightAt(e.x, e.y), !!((e.st ?? 0) & 4096), dt);
        continue;
      }
      if (e.k === 5) {
        let bv = bulwarkViews.get(e.id);
        if (!bv) { bv = new BulwarkView(e.id, e.t, e.b ?? 0, ally, e.o); bulwarkViews.set(e.id, bv); scene.add(bv.root); }
        bv.setLevel(e.lv ?? 1);
        bv.place(e.x, e.y, terrain.heightAt(e.x, e.y), e.hp / e.mh, cam.camera, dt);
        continue;
      }
      if (e.k === 1 && e.u === 'wolf') {
        let wv = wolves.get(e.id);
        if (!wv) { wv = new WolfView(e.id, e.t, ally); wolves.set(e.id, wv); scene.add(wv.root); }
        if ((e.st ?? 0) & 4 || e.hp <= 0) wv.setDead(true);
        wv.place(e.x, e.y, terrain.heightAt(e.x, e.y), e.f, e.hp / e.mh, cam.camera, dt);
        continue;
      }
      if (e.k === 2 || e.k === 4) {
        let sv = structures.get(e.id);
        if (!sv) { sv = new StructureView(e.id, e.t, e.k === 2 ? 'tower' : 'heart', ally); structures.set(e.id, sv); scene.add(sv.root); }
        sv.place(e.x, e.y, terrain.heightAt(e.x, e.y), e.hp / e.mh, !!((e.st ?? 0) & 16), cam.camera);
        continue;
      }
      const isLocal = !!me && e.o === me.playerId;
      let v = units.get(e.id);
      if (!v) { v = new UnitView(e.id, e.t, e.k === 0, ally, isLocal, e.h, e.u); units.set(e.id, v); scene.add(v.root); }
      let x = e.x, y = e.y, f = e.f;
      if (isLocal && predictor.render) {
        ({ x, y } = predictor.render);
        f = now < facingOverride.until ? facingOverride.aim : predictor.facing;
        if ((mine?.st ?? 0) & 32) f = mine!.f;
      }
      const st = e.st ?? 0;
      v.character.setDead(!!(st & 4));
      v.character.setStunned(!!(st & 1));
      if (st & 1024 && e.rp !== undefined) { const b = lastSeen.get(e.rp); if (b) f = Math.atan2(b.y - y, b.x - x); }
      v.place(x, y, terrain.heightAt(x, y), f, e.hp / e.mh, cam.camera, dt);
      v.setStatus(st, dt);
      if (isLocal) { heroWorld.copy(v.root.position); v.character.setFirstPerson(cam.firstPerson); }
      if (st & 256 && Math.random() < dt * 8) vfx.heal(v.root.position, false);
      // Repairs: hammer blows on a cadence, sparks on the structure.
      if (st & 1024 && e.rp !== undefined) {
        const t = (repairT.get(e.id) ?? 0) - dt;
        if (t <= 0) {
          v.character.play('repair', 0.5);
          const bv = bulwarkViews.get(e.rp);
          if (bv) { const sp = bv.root.position.clone().setY(bv.root.position.y + 1.2); setTimeout(() => { vfx.sparks(sp); sfx.play('hammer', sp, { volume: isLocal ? 0.8 : 0.5 }); }, 200); }
          repairT.set(e.id, 0.5);
        } else repairT.set(e.id, t);
      }
      if (st & 32 && Math.random() < 0.7) vfx.emit(v.root.position.clone().setY(v.root.position.y + 1), 2, { color: e.h === 'sigrun' ? 0xaee6ff : 0xe9d7a8, speed: 0.4, life: 0.4, size: 0.35, gravity: 0 });
    }
    for (const c of [...collapsing]) if (!c.collapse(dt)) { scene.remove(c.root); collapsing.splice(collapsing.indexOf(c), 1); }

    // ---- Bulwarks: placement ghost, focus (upgrade/sell), range rings, treasury --------------------
    const myTeam = me?.team ?? 0;
    rangeRing.visible = false; focus = null;
    if (predictor.pos && mine) {
      const aimP = reticleGround(40);
      if (buildOpen && ghost) {
        const x = Math.round(aimP.x / 2) * 2, y = Math.round(aimP.y / 2) * 2;
        const cost = BULWARKS[buildType].levels[0].cost;
        let why = World.siteProblem({ map, nav }, myTeam, x, y);
        if (!why && Math.hypot(x - predictor.pos.x, y - predictor.pos.y) > ECON.buildRange) why = 'too far — move closer';
        if (!why && (mine.g ?? 0) < cost) why = 'not enough gold';
        if (!why && [...bulwarkViews.values()].some((b) => { const e = lastSeen.get(b.id); return e && e.x === x && e.y === y; })) why = 'occupied';
        ghostSite = { x, y, ok: !why, why };
        ghost.position.copy(toWorld(x, y, terrain.heightAt(x, y)));
        ghost.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = why ? ghostBad : ghostOk; });
        const l = BULWARKS[buildType].levels[0];
        const r = l.range ?? l.aura;
        if (r) { rangeRing.visible = true; rangeRing.position.copy(ghost.position).setY(ghost.position.y + 0.15); rangeRing.scale.setScalar(r); }
        td.tooltip(why ? `<b>${BULWARKS[buildType].name}</b> · ${why}` : `<b>${BULWARKS[buildType].name}</b> · ${cost} gold · ${BULWARKS[buildType].blurb}`);
      } else {
        // Look at an own structure nearby to upgrade/sell it.
        let best: BulwarkView | null = null, bd = 2.6;
        for (const bv of bulwarkViews.values()) {
          if (bv.team !== myTeam) continue;
          const e = lastSeen.get(bv.id); if (!e) continue;
          const d = Math.hypot(e.x - aimP.x, e.y - aimP.y);
          if (d < bd && Math.hypot(e.x - predictor.pos.x, e.y - predictor.pos.y) < ECON.interactRange) { bd = d; best = bv; }
        }
        focus = best;
        if (best) {
          const e = lastSeen.get(best.id)!, lv = e.lv ?? 1, def = BULWARKS[best.type];
          const refund = Math.floor(investedIn(best.type, lv) * ECON.sellRefund * (best.type === 'spikes' ? 1 : e.hp / e.mh));
          const up = lv < 3 ? `<kbd>U</kbd> upgrade <b>${def.levels[lv]!.cost}</b>` : 'max level';
          const dmgd = best.type !== 'spikes' && e.hp < e.mh;
          const repCost = Math.ceil(investedIn(best.type, lv) * REPAIR.costFrac * (1 - e.hp / e.mh) * (1 - itemStats(mine.it ?? []).repair * 0.66));
          const rep = dmgd ? ` · <kbd>F</kbd> ${(mine.st ?? 0) & 1024 ? 'stop repairing' : `repair <b>~${repCost}</b>`}` : '';
          td.tooltip(`<b>${def.name}</b> L${lv} · ${Math.ceil(e.hp)}/${e.mh} · ${up} · <kbd>X</kbd> sell <b>+${refund}</b>${rep}`);
          if (best.range > 2) { rangeRing.visible = true; rangeRing.position.copy(best.root.position).setY(best.root.position.y + 0.15); rangeRing.scale.setScalar(best.range); }
        } else td.tooltip(null);
      }
      const hearts: [number, number] = [1, 1];
      for (const sv of structures.values()) if (sv.kind === 'heart') { const e = lastSeen.get(sv.id); if (e) hearts[sv.team === myTeam ? 0 : 1] = e.hp / e.mh; }
      td.update(mine.g ?? 0, mine.inc ?? 0, waveNo, nextWave, hearts);
    }

    // Ground-target preview while an AoE key is held.
    const gSlot = heroDef.abilities.findIndex((a, i) => (a.kind === 'groundAoe' || a.kind === 'trap') && held[i + 1]);
    if (gSlot >= 0 && predictor.pos) {
      const ab = heroDef.abilities[gSlot]!;
      let p = reticleGround();
      const d = Math.hypot(p.x - predictor.pos.x, p.y - predictor.pos.y), r = ab.range ?? 10;
      if (d > r) p = { x: predictor.pos.x + ((p.x - predictor.pos.x) / d) * r, y: predictor.pos.y + ((p.y - predictor.pos.y) / d) * r };
      if (!groundPreview) {
        groundPreview = new THREE.Mesh(new THREE.RingGeometry((ab.radius ?? 3) - 0.15, ab.radius ?? 3, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: teamColor(me?.team ?? 0), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
        scene.add(groundPreview);
      }
      groundPreview.position.copy(toWorld(p.x, p.y, terrain.heightAt(p.x, p.y) + 0.2));
    }

    cam.update(heroWorld, dt);
    if (debugView) { cam.camera.position.set(...debugView.pos); cam.camera.lookAt(...debugView.at); }
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.camera.quaternion);
    sfx.setListener(cam.camera.position, fwd);
    // Footsteps for the local hero.
    if (predictor.pos && (mx || my) && !cam.firstPerson) { stepT -= dt; if (stepT <= 0) { stepT = 0.34; sfx.play('footstep', heroWorld, { volume: 0.5 }); } }

    // Sun + shadow frustum follow the player (texel-snapped to avoid shimmering).
    const snap = 64 / (q.shadowMap || 1024);
    sun.target.position.set(Math.round(heroWorld.x / snap) * snap, heroWorld.y, Math.round(heroWorld.z / snap) * snap);
    sun.position.copy(sun.target.position).addScaledVector(sky.sunDir, 120);

    const t = clock.elapsedTime;
    terrain.update(t); foliage.update(t, cam.camera.position, dt); props.update(t); updateFire(t); vfx.update(dt);
    const pp = predictor.render;
    if (pp) {
      markers.forEach((m, i) => hud.setMarkerYaw(i, Math.atan2(-(m.p.x - pp.x), m.p.y - pp.y)));
      const cds = [0, 1, 2, 3].map((i) => Math.max((mine?.cd?.[i] ?? 0) / 10, (localCdUntil[i]! - now) / 1000, 0));
      const mst = mine?.st ?? 0;
      let channel: { label: string; p: number } | null = null;
      if (mst & 8192) channel = { label: 'Hearth Recall', p: mine?.rc ?? 0 };
      else if (mst & 1024 && mine?.rp !== undefined) { const b = lastSeen.get(mine.rp); if (b) channel = { label: 'Repairing', p: b.hp / b.mh }; }
      hud.update(cam.yaw, { hpFrac: mine ? mine.hp / mine.mh : 1, level: mine?.lv ?? 1, xp: mine?.xp ?? 0, cds, dead: !!(mst & 4), respawn: mine?.rs ?? 0,
        shieldFrac: mine ? (mine.sh ?? 0) / mine.mh : 0, st: mst, items: mine?.it ?? [], channel }, input.locked, cdTotalsNow());
      if (mine && mst & 4) hud.message('You have fallen', `Rising again in ${mine.rs ?? 0}s`);
      if (mine && me) {
        shop.update(mine.g ?? 0, mine.it ?? [], canShop());
        const heroes = [...lastSeen.values()].filter((e) => e.k === 0);
        const nm = (e: EntitySnapshot) => (e.o === me!.playerId ? 'You' : e.o?.startsWith('bot:') ? 'Bot' : 'Player');
        hud.setParty(heroes.filter((e) => e.t === me!.team).sort((a, b) => a.id - b.id).map((e) => ({ id: e.id, name: nm(e), heroId: e.h ?? '', hpFrac: e.hp / e.mh, level: e.lv ?? 1, dead: !!((e.st ?? 0) & 4), respawn: e.rs ?? 0, me: e.id === mine!.id })));
        if (boardOpen) hud.setBoard(true, heroes.sort((a, b) => a.id - b.id).map((e) => ({ name: nm(e), heroId: e.h ?? '', team: e.t, level: e.lv ?? 1, k: e.kd?.[0] ?? 0, d: e.kd?.[1] ?? 0, items: e.it ?? [], me: e.id === mine!.id, dead: !!((e.st ?? 0) & 4) })),
          `${Math.floor(matchSec / 60)}:${String(matchSec % 60).padStart(2, '0')} · wave ${waveNo}`);
      }
    }
    hud.updateFloating(dt, project);

    if (composer) composer.render(); else renderer.render(scene, cam.camera);

    frameMs = frameMs * 0.95 + (performance.now() - t0) * 0.05;
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) {
      fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0;
      // Governor: sustained < 40 fps sheds DPR, then post-processing.
      slow = fps < 40 ? slow + 1 : 0;
      if (slow >= 8 && !params.has('quality')) {
        slow = 0;
        if (renderer.getPixelRatio() > 1) renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() - 0.5));
        else if (composer) { composer = null; tier = 'low'; }
        resize();
      }
      hud.updateStats({ fps, ms: frameMs, tier, mode: transport.kind, status, rtt: transport.rtt, tick: lastTick, ents: units.size, draws: renderer.info.render.calls, tris: renderer.info.render.triangles });
    }
    requestAnimationFrame(frame);
  }
  /** QA hook: pin the camera to an arbitrary viewpoint (set from automated tests). */
  let debugView: { pos: [number, number, number]; at: [number, number, number] } | null = null;
  requestAnimationFrame(frame);
  (window as unknown as { __lumen: unknown }).__lumen = {
    views: units, structures, cam, predictor, interp, get me() { return me; }, get mine() { return mine; }, get tick() { return lastTick; }, transport, renderer,
    setDebugView: (v: typeof debugView) => { debugView = v; }, fire, map, bulwarkViews, traps, shop, hud, vfx, sfx, toggleShop, held,
  };
}

boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;color:#f88;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`); });
