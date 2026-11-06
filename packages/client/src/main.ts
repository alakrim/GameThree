import * as THREE from 'three';
import { createMap, NavGrid, type Snapshot } from '@lumen/shared';
import { manager } from './assets.js';
import { setupSky } from './render/sky.js';
import { buildTerrain, toWorld } from './render/terrain.js';
import { buildFoliage } from './render/foliage.js';
import { buildProps } from './render/props.js';
import { updateFire } from './render/fire.js';
import { preloadCharacterAssets } from './render/character.js';
import { UnitView } from './render/units.js';
import { ThirdPersonCamera } from './render/camera.js';
import { createComposer } from './render/post.js';
import { detectTier, qualityFor, type Tier } from './render/quality.js';
import { Interpolator } from './net/interp.js';
import { Predictor } from './net/prediction.js';
import { LocalTransport, WsTransport, type Transport, type Welcome } from './net/transport.js';
import { Input } from './input/input.js';
import { Hud, LoadingScreen, markerColors } from './ui/hud.js';

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
  const cam = new ThirdPersonCamera(groundAtWorld);
  let composer = q.bloom || q.tier !== 'low' ? createComposer(renderer, scene, cam.camera, q.bloom) : null;
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); composer?.setSize(innerWidth, innerHeight); cam.resize(innerWidth, innerHeight); };
  addEventListener('resize', resize); resize();

  // ---- Net + prediction -----------------------------------------------------------------------
  const serverUrl = params.get('server');
  const transport: Transport = serverUrl ? new WsTransport(serverUrl) : new LocalTransport();
  const interp = new Interpolator();
  let me: Welcome | null = null, status = 'connecting', lastTick = 0;
  const predictor = new Predictor(nav, (c) => transport.send(c));
  const input = new Input(canvas, cam);
  const hud = new Hud(document.getElementById('hud')!, input.touch, () => cam.toggleView());

  transport.onStatus = (s) => { status = s; };
  transport.onWelcome = (w) => {
    me = w;
    cam.yaw = w.team === 0 ? -Math.PI / 4 : (3 * Math.PI) / 4; // face the valley from the fort
    const ownFort = map.bases[w.team].pos, enemyFort = map.bases[w.team === 0 ? 1 : 0].pos;
    markers = [{ p: ownFort, color: markerColors.ally(w.team), label: 'Your fort' }, { p: enemyFort, color: markerColors.enemy, label: 'Enemy fort' }];
    hud.setMarkers(markers.map((m) => ({ yaw: 0, color: m.color, label: m.label })));
  };
  let markers: { p: { x: number; y: number }; color: string; label: string }[] = [];
  transport.onSnapshot = (s: Snapshot) => {
    interp.push(s, performance.now()); lastTick = s.tick;
    const mine = me && s.ents.find((e) => e.o === me!.playerId);
    if (mine) predictor.reconcile({ x: mine.x, y: mine.y }, mine.sq ?? 0);
  };

  const views = new Map<number, UnitView>();
  /** QA hook: pin the camera to an arbitrary viewpoint (set from automated tests). */
  let debugView: { pos: [number, number, number]; at: [number, number, number] } | null = null;
  const clock = new THREE.Clock();
  let fpsAcc = 0, fpsFrames = 0, fps = 60, frameMs = 16, slow = 0, myHp = 1;
  const heroWorld = new THREE.Vector3();

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t0 = performance.now();
    renderer.info.reset();
    transport.update(dt);
    const [mx, my] = input.movement();
    predictor.step(dt, mx, my);

    const now = performance.now();
    const ents = interp.sample(now);
    for (const [id, v] of views) if (!ents.has(id)) { scene.remove(v.root); views.delete(id); }
    for (const e of ents.values()) {
      const isLocal = !!me && e.o === me.playerId;
      let v = views.get(e.id);
      if (!v) {
        v = new UnitView(e.id, e.t, e.k === 0, me ? e.t === me.team : e.t === 0, isLocal);
        views.set(e.id, v); scene.add(v.root);
      }
      let x = e.x, y = e.y, f = e.f;
      if (isLocal && predictor.render) { ({ x, y } = predictor.render); f = predictor.facing; myHp = e.hp / e.mh; }
      v.place(x, y, terrain.heightAt(x, y), f, e.hp / e.mh, cam.camera, dt);
      if (isLocal) { heroWorld.copy(v.root.position); v.character.setFirstPerson(cam.firstPerson); }
    }

    cam.update(heroWorld, dt);
    if (debugView) { cam.camera.position.set(...debugView.pos); cam.camera.lookAt(...debugView.at); }
    // Sun + shadow frustum follow the player (texel-snapped to avoid shimmering).
    const snap = 64 / (q.shadowMap || 1024);
    const tx = Math.round(heroWorld.x / snap) * snap, tz = Math.round(heroWorld.z / snap) * snap;
    sun.target.position.set(tx, heroWorld.y, tz);
    sun.position.copy(sun.target.position).addScaledVector(sky.sunDir, 120);

    const t = clock.elapsedTime;
    terrain.update(t); foliage.update(t, cam.camera.position, dt); props.update(t); updateFire(t);
    const pp = predictor.render;
    if (pp) hud.update(cam.yaw, myHp, input.locked, input.touch);
    if (pp) markers.forEach((m, i) => hud.setMarkerYaw(i, Math.atan2(-(m.p.x - pp.x), m.p.y - pp.y)));

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
      hud.updateStats({ fps, ms: frameMs, tier, mode: transport.kind, status, rtt: transport.rtt, tick: lastTick, ents: views.size, draws: renderer.info.render.calls, tris: renderer.info.render.triangles });
    }
    requestAnimationFrame(frame);
  }
  // Compile shaders up-front so the first frames don't hitch.
  await renderer.compileAsync(scene, cam.camera);
  loading.progress(1); loading.done();
  requestAnimationFrame(frame);
  (window as unknown as { __lumen: unknown }).__lumen = { views, cam, predictor, interp, get me() { return me; }, get tick() { return lastTick; }, transport, renderer, setDebugView: (v: typeof debugView) => { debugView = v; } };
}

boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;color:#f88;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`); });
