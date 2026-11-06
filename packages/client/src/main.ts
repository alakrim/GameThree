import * as THREE from 'three';
import { createMap, NavGrid, HEROES, DEFAULT_HERO, TICK_RATE, type Snapshot, type GameEvent, type EntitySnapshot } from '@lumen/shared';
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
  input.onAct = (s, ph) => onAct(s, ph);
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
  transport.onSnapshot = (s: Snapshot) => {
    interp.push(s, performance.now()); lastTick = s.tick;
    for (const ev of s.ev ?? []) eventQueue.push({ t: (s.tick * 1000) / TICK_RATE, ev });
    mine = me ? s.ents.find((e) => e.o === me!.playerId) : undefined;
    if (mine) predictor.reconcile({ x: mine.x, y: mine.y }, mine.sq ?? 0, mine.sm ?? 1, !!((mine.st ?? 0) & (1 | 4 | 32)));
  };

  // ---- Aiming ---------------------------------------------------------------------------------
  /** March the camera's centre ray over the terrain; returns the sim-space point under the reticle. */
  const reticleGround = (maxDist = 70): { x: number; y: number } => {
    const o = cam.camera.position, d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.camera.quaternion);
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
    if (ab?.kind === 'groundAoe') { // hold to aim, release to cast
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
    localCdUntil[slot] = now + cdTotals[slot]! * 1000;
    const windup = slot === 0 ? heroDef.attack.windup : heroDef.abilities[slot - 1]!.windup;
    facingOverride = { aim, until: now + windup * 1000 + 250 };
    playActionLocal(slot, aim, pos.x, pos.y);
    return true;
  }

  // ---- Entity views ---------------------------------------------------------------------------
  const units = new Map<number, UnitView>();
  const structures = new Map<number, StructureView>();
  const collapsing: StructureView[] = [];
  const projectiles = new Map<number, ProjectileView>();
  const lastSeen = new Map<number, InterpEntity>();
  const worldPos = (id: number) => { const e = lastSeen.get(id); return e ? toWorld(e.x, e.y, terrain.heightAt(e.x, e.y)) : null; };

  const actionAnim = (heroKey: string | undefined, slot: number) => {
    if (!heroKey) return 'attack' as const;
    const def = HEROES[heroKey]!;
    if (slot === 0) return def.attack.kind === 'melee' ? 'attack' as const : 'shoot' as const;
    const k = def.abilities[slot - 1]!.kind;
    return k === 'cone' ? 'attack' as const : k === 'selfAoe' ? 'slam' as const : k === 'dash' ? 'attack' as const : 'cast' as const;
  };

  function playActionLocal(slot: number, aim: number, x: number, y: number) {
    const v = [...units.values()].find((u) => u.isLocal);
    const kind = actionAnim(heroId, slot);
    v?.character.play(kind, slot === 0 ? Math.max(0.4, heroDef.attack.cooldown * 0.6) : 0.6);
    const p = toWorld(x, y, terrain.heightAt(x, y));
    soundFor(heroId, slot, p);
    if (kind === 'attack' && (slot === 0 || heroDef.abilities[slot - 1]!.kind === 'cone')) {
      setTimeout(() => vfx.slash(p, aim, slot === 0 ? 0xfff2d8 : 0xffc27a, slot === 0 ? 2.6 : 3.8), (slot === 0 ? heroDef.attack.windup : heroDef.abilities[slot - 1]!.windup) * 1000);
    }
  }

  function soundFor(hid: string | undefined, slot: number, at: THREE.Vector3) {
    if (!hid) { sfx.play('swing', at, { volume: 0.5, pitch: 1.2 }); return; }
    const def = HEROES[hid]!;
    if (slot === 0) { sfx.play(def.attack.kind === 'melee' ? 'swing' : 'frostBolt', at); return; }
    const ab = def.abilities[slot - 1]!;
    sfx.play(ab.kind === 'dash' ? 'dash' : ab.kind === 'selfAoe' ? 'horn' : ab.kind === 'cone' ? 'swing' : 'cast', at, { pitch: ab.kind === 'cone' ? 0.8 : 1 });
  }

  function handleEvent(ev: GameEvent) {
    const isMe = (id: number) => !!mine && id === mine.id;
    switch (ev.e) {
      case 'act': {
        const src = lastSeen.get(ev.s);
        if (!src || isMe(ev.s)) return; // own actions were played immediately on input
        const p = worldPos(ev.s)!;
        if (src.k === 2) { sfx.play('towerShot', p.clone().setY(p.y + 8)); return; }
        const u = units.get(ev.s);
        const kind = actionAnim(src.h, ev.a);
        u?.character.play(kind, 0.55);
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
        if (mineSrc || mineTgt || (tgt?.k === 0)) hud.damage(chest.x, chest.y + 1, chest.z, ev.n, mineTgt ? 'taken' : ev.k === 1 ? 'ab' : '');
        break;
      }
      case 'die': {
        const p = worldPos(ev.d); if (!p) return;
        const tgt = lastSeen.get(ev.d);
        if (tgt?.k === 2) { const sv = structures.get(ev.d); if (sv) { collapsing.push(sv); structures.delete(ev.d); } vfx.dust(p.clone().setY(p.y + 2), 80); sfx.play('explosion', p); }
        else if (tgt?.k === 4) { vfx.blast(p.x, p.z, 10, 'fire'); sfx.play('explosion', p, { volume: 1 }); }
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
        const kind = ev.fx === 'glacial_burst' ? 'frost' : 'horn';
        vfx.blast(ev.x, -ev.y, ev.r, kind);
        sfx.play(kind === 'frost' ? 'explosion' : 'hit', toWorld(ev.x, ev.y, terrain.heightAt(ev.x, ev.y)), { pitch: kind === 'frost' ? 1.2 : 0.7 });
        break;
      }
      case 'pop': {
        const p = toWorld(ev.x, ev.y, terrain.heightAt(ev.x, ev.y) + 1.2);
        if (ev.fx === 'ice_lance' || ev.fx === 'sigrun_basic') { vfx.impact(p, 0xaee6ff, ev.fx === 'ice_lance'); sfx.play('iceShatter', p, { volume: ev.fx === 'ice_lance' ? 1 : 0.5 }); }
        break;
      }
      case 'spawn': if (isMe(ev.s)) hud.clearMessage(); break;
      case 'win': {
        const won = !!me && ev.t === me.team;
        hud.message(won ? 'Victory' : 'Defeat', won ? 'The enemy Heartstone is shattered' : 'Your Heartstone has fallen', won ? 'victory' : 'defeat');
        sfx.play(won ? 'victory' : 'defeat');
        break;
      }
      case 'reset': hud.clearMessage(); for (const sv of structures.values()) scene.remove(sv.root); structures.clear(); break;
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
    lastSeen.clear();
    for (const e of ents.values()) {
      lastSeen.set(e.id, e);
      const ally = me ? e.t === me.team : e.t === 0;
      if (e.k === 3) {
        let pv = projectiles.get(e.id);
        if (!pv) { pv = new ProjectileView(e.fx ?? '', vfx); projectiles.set(e.id, pv); scene.add(pv.root); }
        pv.place(toWorld(e.x, e.y, terrain.heightAt(e.x, e.y) + (e.fx === 'tower_bolt' ? 0 : 1.25)), e.f, dt);
        if (e.fx === 'tower_bolt') pv.root.position.y = Math.max(pv.root.position.y, terrain.heightAt(e.x, e.y) + 1.4);
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
      if (!v) { v = new UnitView(e.id, e.t, e.k === 0, ally, isLocal, e.h); units.set(e.id, v); scene.add(v.root); }
      let x = e.x, y = e.y, f = e.f;
      if (isLocal && predictor.render) {
        ({ x, y } = predictor.render);
        f = now < facingOverride.until ? facingOverride.aim : predictor.facing;
        if ((mine?.st ?? 0) & 32) f = mine!.f;
      }
      const st = e.st ?? 0;
      v.character.setDead(!!(st & 4));
      v.character.setStunned(!!(st & 1));
      v.place(x, y, terrain.heightAt(x, y), f, e.hp / e.mh, cam.camera, dt);
      if (isLocal) { heroWorld.copy(v.root.position); v.character.setFirstPerson(cam.firstPerson); }
      if (st & 32 && Math.random() < 0.7) vfx.emit(v.root.position.clone().setY(v.root.position.y + 1), 2, { color: e.h === 'sigrun' ? 0xaee6ff : 0xe9d7a8, speed: 0.4, life: 0.4, size: 0.35, gravity: 0 });
    }
    for (const c of [...collapsing]) if (!c.collapse(dt)) { scene.remove(c.root); collapsing.splice(collapsing.indexOf(c), 1); }

    // Ground-target preview while an AoE key is held.
    const gSlot = heroDef.abilities.findIndex((a, i) => a.kind === 'groundAoe' && held[i + 1]);
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
      hud.update(cam.yaw, { hpFrac: mine ? mine.hp / mine.mh : 1, level: mine?.lv ?? 1, xp: mine?.xp ?? 0, cds, dead: !!((mine?.st ?? 0) & 4), respawn: mine?.rs ?? 0 }, input.locked, cdTotals);
      if (mine && (mine.st ?? 0) & 4) hud.message('You have fallen', `Rising again in ${mine.rs ?? 0}s`);
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
    setDebugView: (v: typeof debugView) => { debugView = v; }, fire,
  };
}

boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;color:#f88;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`); });
