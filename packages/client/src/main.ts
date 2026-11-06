import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createMap } from '@lumen/shared';
import { buildArena, toWorld } from './render/arena.js';
import { CameraRig } from './render/camera.js';
import { HeroView, MinionView, MoveMarker } from './render/units.js';
import { PALETTE, teamHi } from './render/palette.js';
import { detectTier, qualityFor, type Tier } from './render/quality.js';
import { Interpolator } from './net/interp.js';
import { LocalTransport, WsTransport, type Transport, type Welcome } from './net/transport.js';
import { Input } from './input/input.js';
import { Hud } from './ui/hud.js';

const params = new URLSearchParams(location.search);
let tier: Tier = detectTier();
const q = qualityFor(tier);

// ---- Renderer -------------------------------------------------------------------------------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, q.dprCap));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = q.shadows;
renderer.info.autoReset = false; // count all passes per frame
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.cloudDeep);
scene.fog = new THREE.Fog(PALETTE.cloudDeep, 70, 190);

const hemi = new THREE.HemisphereLight(PALETTE.skyFill, PALETTE.groundFill, 1.25);
const key = new THREE.DirectionalLight(PALETTE.keyLight, 2.4);
key.position.set(-30, 60, 25);
key.castShadow = q.shadows;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 });
key.shadow.bias = -0.0008;
scene.add(hemi, key, key.target);

const map = createMap(1337);
const arena = buildArena(map, q);
scene.add(arena.group);

const rig = new CameraRig(map.half - 12);
let composer: EffectComposer | null = null;
if (q.bloom) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, rig.camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82));
  composer.addPass(new OutputPass());
}
const resize = () => {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer?.setSize(w, h);
  rig.resize(w, h);
};
addEventListener('resize', resize); resize();

// ---- Net ------------------------------------------------------------------------------------
const serverUrl = params.get('server');
const transport: Transport = serverUrl ? new WsTransport(serverUrl) : new LocalTransport();
const interp = new Interpolator();
let me: Welcome | null = null;
let status = 'connecting';
let lastTick = 0;
transport.onWelcome = (w) => { me = w; };
transport.onStatus = (s) => { status = s; };
transport.onSnapshot = (s) => { interp.push(s, performance.now()); lastTick = s.tick; };

// ---- Views ----------------------------------------------------------------------------------
const views = new Map<number, HeroView | MinionView>();
const marker = new MoveMarker(teamHi(0));
scene.add(marker.mesh);

const input = new Input(canvas, rig, {
  onMoveOrder: (p) => { marker.show(p); transport.send({ type: 'move', x: p.x, y: -p.z }); },
  onStop: () => transport.send({ type: 'stop' }),
});
const hud = new Hud(document.getElementById('hud')!, { recenter: () => { rig.locked = true; }, stop: () => transport.send({ type: 'stop' }) });
rig.target.copy(toWorld(map.bases[0].pos.x, map.bases[0].pos.y));

// ---- Loop -----------------------------------------------------------------------------------
const clock = new THREE.Clock();
let fpsAcc = 0, fpsFrames = 0, fps = 60, frameMs = 16, slowFrames = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t0 = performance.now();
  renderer.info.reset();
  transport.update(dt);
  input.update(dt);

  const ents = interp.sample(performance.now());
  for (const [id, v] of views) if (!ents.has(id)) { scene.remove(v.root); views.delete(id); }
  for (const e of ents.values()) {
    let v = views.get(e.id);
    if (!v) {
      const ally = me ? e.t === me.team : e.t === 0;
      v = e.k === 0 ? new HeroView(e.id, e.t, ally, e.o === me?.playerId, q.outlines) : new MinionView(e.id, e.t, ally, q.outlines);
      if (e.o === me?.playerId) (marker.mesh.material as THREE.MeshBasicMaterial).color.setHex(teamHi(e.t));
      views.set(e.id, v); scene.add(v.root);
    }
    v.apply(e, rig.camera, dt);
    if (me && e.o === me.playerId) rig.setFollow(v.root.position);
  }

  rig.update(dt);
  key.position.set(rig.target.x - 30, 60, rig.target.z + 25);
  key.target.position.copy(rig.target);
  arena.update(clock.elapsedTime);
  marker.update(dt);
  if (composer) composer.render(); else renderer.render(scene, rig.camera);

  // Perf governor: sustained slow frames => drop to a cheaper tier (requires reload of heavy resources; we cut DPR + bloom live).
  frameMs = frameMs * 0.95 + (performance.now() - t0) * 0.05;
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) {
    fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0;
    slowFrames = fps < 45 ? slowFrames + 1 : 0;
    if (slowFrames >= 6 && tier !== 'low') {
      tier = tier === 'high' ? 'medium' : 'low';
      renderer.setPixelRatio(Math.min(devicePixelRatio, qualityFor(tier).dprCap));
      if (tier === 'low') composer = null;
      resize(); slowFrames = 0;
    }
    hud.update({ fps, ms: frameMs, tier, mode: transport.kind, status, rtt: transport.rtt, tick: lastTick, ents: views.size, draws: renderer.info.render.calls });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Expose a tiny debug/QA surface for automated smoke tests.
(window as unknown as { __lumen: unknown }).__lumen = { views, rig, get tick() { return lastTick; }, transport };
