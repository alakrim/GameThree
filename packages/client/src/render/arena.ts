import * as THREE from 'three';
import { type MapDef, distToPolyline, distToSegment, Rng } from '@lumen/shared';
import { PALETTE, teamColor, teamHi } from './palette.js';
import { toonMaterial, outlineMaterial, hullGeometry } from './toon.js';
import type { QualitySettings } from './quality.js';

/** Sim (x, y) -> world (x, 0, -y). Single conversion point for the whole client. */
export const toWorld = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export interface Arena { group: THREE.Group; cloud: THREE.Mesh; update(t: number): void }

export function buildArena(map: MapDef, q: QualitySettings): Arena {
  const group = new THREE.Group();
  const rng = new Rng(map.seed ^ 0x9e3779b9);
  const lanes = Object.values(map.lanes);

  // ---- Island terrain: vertex-painted lanes / moss / river / terraces --------------------
  const size = map.half * 2;
  const seg = q.terrainSegments;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const cMoss = new THREE.Color(PALETTE.moss), cStone = new THREE.Color(PALETTE.stone), cRiver = new THREE.Color(PALETTE.cloudHi);
  const cGold = new THREE.Color(PALETTE.gold), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i), wz = pos.getZ(i);
    const p = { x: wx, y: -wz };
    const laneD = Math.min(...lanes.map((l) => distToPolyline(p, l)));
    const riverD = distToSegment(p, map.river[0], map.river[1]);
    const edge = Math.max(Math.abs(p.x), Math.abs(p.y));
    // Gentle hand-sculpted undulation; lanes stay flat for readability.
    let h = (Math.sin(p.x * 0.11) * Math.cos(p.y * 0.13) + Math.sin(p.x * 0.031 + p.y * 0.047)) * 0.35 * smooth(map.laneHalfWidth, map.laneHalfWidth + 4, laneD);
    const riverT = 1 - smooth(map.riverHalfWidth - 2, map.riverHalfWidth + 1.5, riverD);
    h -= riverT * 0.9;
    h -= smooth(map.half - 6, map.half, edge) * 1.2;
    let baseT = 0;
    for (const t of [0, 1] as const) {
      const d = Math.hypot(p.x - map.bases[t].pos.x, p.y - map.bases[t].pos.y);
      baseT = Math.max(baseT, 1 - smooth(map.bases[t].radius - 2, map.bases[t].radius + 1, d));
    }
    h = h * (1 - baseT) + baseT * 0.35;
    pos.setY(i, h);
    const n = rng.range(-0.04, 0.04);
    tmp.copy(cMoss).offsetHSL(0, 0, n);
    tmp.lerp(cStone, 1 - smooth(map.laneHalfWidth - 1.5, map.laneHalfWidth + 1, laneD));
    tmp.lerp(cGold, baseT * 0.45);
    tmp.lerp(cRiver, riverT * 0.85);
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, toonMaterial({ color: 0xffffff, vertexColors: true, rimStrength: 0 }));
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  // Island cliff skirt
  const cliff = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.72, size * 0.5, 14, 4, 1, true), toonMaterial({ color: 0x4c4a55, flat: true, rimStrength: 0.15 }));
  cliff.rotation.y = Math.PI / 4; cliff.position.y = -8.2; cliff.scale.set(1, 1, 1);
  group.add(cliff);

  // ---- Cloud sea (animated shader) --------------------------------------------------------
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDeep: { value: new THREE.Color(PALETTE.cloudDeep) }, uHi: { value: new THREE.Color(PALETTE.cloudHi) }, uGold: { value: new THREE.Color(PALETTE.gold) } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uDeep, uHi, uGold; varying vec2 vUv; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
      void main(){
        vec2 p = vW.xz * 0.025;
        float c = fbm(p + vec2(uTime*0.02, uTime*0.013)) * 0.7 + fbm(p*2.3 - uTime*0.03) * 0.3;
        float bands = floor(c * 4.0) / 4.0;              // posterized like a lacquer painting
        vec3 col = mix(uDeep, uHi, bands);
        float glint = smoothstep(0.72, 0.78, c) * 0.35;  // gold-leaf flecks
        col += uGold * glint;
        float r = length(vW.xz) / 260.0;
        gl_FragColor = vec4(mix(col, uDeep * 0.7, smoothstep(0.4, 1.0, r)), 1.0);
      }`,
  });
  const cloud = new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 1, 1), cloudMat);
  cloud.rotation.x = -Math.PI / 2; cloud.position.y = -10;
  group.add(cloud);

  // ---- Obstacles (instanced, with instanced outline hulls) --------------------------------
  const groves = map.obstacles.filter((o) => o.kind === 'grove');
  const rocks = map.obstacles.filter((o) => o.kind === 'rock');
  const addInstanced = (g: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], outline: number) => {
    const im = new THREE.InstancedMesh(g, mat, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = true; im.receiveShadow = true;
    group.add(im);
    if (q.outlines && outline > 0) {
      const hull = new THREE.InstancedMesh(hullGeometry(g), outlineMaterial(outline), mats.length);
      mats.forEach((m, i) => hull.setMatrixAt(i, m));
      group.add(hull);
    }
  };
  const M = (x: number, y: number, z: number, s: THREE.Vector3, rotY = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), s);

  const trunks: THREE.Matrix4[] = [], canopyA: THREE.Matrix4[] = [], canopyB: THREE.Matrix4[] = [], lanterns: THREE.Matrix4[] = [];
  for (const o of groves) {
    // A grove = cluster of 2–4 stylized trees filling the obstacle footprint.
    const count = 2 + (o.variant % 3);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + o.variant, rr = k === 0 ? 0 : o.r * 0.5;
      const x = o.x + Math.cos(a) * rr, y = o.y + Math.sin(a) * rr;
      const s = o.r * (k === 0 ? 0.55 : 0.4);
      const w = toWorld(x, y);
      trunks.push(M(w.x, s * 1.1, w.z, new THREE.Vector3(s * 0.25, s * 2.2, s * 0.25)));
      canopyA.push(M(w.x, s * 2.4, w.z, new THREE.Vector3(s, s * 0.8, s), a));
      canopyB.push(M(w.x, s * 3.3, w.z, new THREE.Vector3(s * 0.65, s * 0.6, s * 0.65), a * 2));
    }
    if (o.variant === 0) { const w = toWorld(o.x + o.r * 0.9, o.y); lanterns.push(M(w.x, 1.1, w.z, new THREE.Vector3(0.45, 0.6, 0.45))); }
  }
  addInstanced(new THREE.CylinderGeometry(0.6, 1, 1, 7), toonMaterial({ color: 0x5a3a2c, rimStrength: 0.1 }), trunks, 0.04);
  addInstanced(new THREE.IcosahedronGeometry(1, 1), toonMaterial({ color: PALETTE.moss, rim: PALETTE.neutral, rimStrength: 0.45, flat: true }), canopyA, 0.045);
  addInstanced(new THREE.IcosahedronGeometry(1, 0), toonMaterial({ color: 0x6f8d55, rim: PALETTE.neutral, rimStrength: 0.45, flat: true }), canopyB, 0.05);
  addInstanced(new THREE.CylinderGeometry(0.8, 0.8, 1.2, 6), toonMaterial({ color: PALETTE.lacquer, emissive: 0xff9a4a, emissiveIntensity: 0.6 }), lanterns, 0.08);

  const rockM: THREE.Matrix4[] = [], veinM: THREE.Matrix4[] = [];
  for (const o of rocks) {
    const w = toWorld(o.x, o.y);
    rockM.push(M(w.x, o.r * 0.35, w.z, new THREE.Vector3(o.r, o.r * 0.9, o.r * 0.95), o.variant));
    veinM.push(M(w.x, o.r * 0.95, w.z, new THREE.Vector3(o.r * 0.35, o.r * 0.18, o.r * 0.35), o.variant * 1.7));
  }
  addInstanced(new THREE.DodecahedronGeometry(1, 0), toonMaterial({ color: PALETTE.stone, rimStrength: 0.2, flat: true }), rockM, 0.035);
  addInstanced(new THREE.OctahedronGeometry(1, 0), toonMaterial({ color: PALETTE.gold, emissive: PALETTE.gold, emissiveIntensity: 0.25, flat: true }), veinM, 0.06);

  // ---- Lane lantern posts (path readability) ----------------------------------------------
  const posts: THREE.Matrix4[] = [], caps: THREE.Matrix4[] = [];
  for (const lane of lanes) for (let i = 0; i < lane.length - 1; i++) {
    const a = lane[i]!, b = lane[i + 1]!;
    const L = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
    for (let d = 8; d < L - 4; d += 14) for (const side of [-1, 1]) {
      const x = a.x + ((b.x - a.x) * d) / L + nx * side * (map.laneHalfWidth + 0.8), y = a.y + ((b.y - a.y) * d) / L + ny * side * (map.laneHalfWidth + 0.8);
      const w = toWorld(x, y);
      posts.push(M(w.x, 0.9, w.z, new THREE.Vector3(0.18, 1.8, 0.18)));
      caps.push(M(w.x, 1.95, w.z, new THREE.Vector3(0.32, 0.38, 0.32)));
    }
  }
  addInstanced(new THREE.BoxGeometry(1, 1, 1), toonMaterial({ color: PALETTE.lacquer, rimStrength: 0.15 }), posts, 0.05);
  addInstanced(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), caps, 0);

  // ---- Base terraces + Lumen cores --------------------------------------------------------
  const cores: THREE.Mesh[] = [];
  for (const t of [0, 1] as const) {
    const b = map.bases[t];
    const w = toWorld(b.pos.x, b.pos.y);
    const base = new THREE.Group(); base.position.copy(w);
    const tiers = [[b.radius * 0.95, 0.5, PALETTE.stone], [b.radius * 0.55, 0.8, 0x9b927f], [b.radius * 0.3, 1.1, 0xb7ad97]] as const;
    let y = 0.3;
    for (const [r, hgt, c] of tiers) {
      const g = new THREE.CylinderGeometry(r, r * 1.04, hgt, 8);
      const m = new THREE.Mesh(g, toonMaterial({ color: c, rimStrength: 0.15 }));
      m.position.y = y + hgt / 2; m.castShadow = m.receiveShadow = true; base.add(m);
      if (q.outlines) { const o = new THREE.Mesh(hullGeometry(g), outlineMaterial(0.05)); o.position.copy(m.position); base.add(o); }
      const trim = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, 0.08, 4, 8), toonMaterial({ color: PALETTE.gold, emissive: PALETTE.gold, emissiveIntensity: 0.2 }));
      trim.rotation.x = Math.PI / 2; trim.position.y = y + hgt; base.add(trim);
      y += hgt;
    }
    const coreG = new THREE.OctahedronGeometry(1.8, 0);
    const core = new THREE.Mesh(coreG, toonMaterial({ color: teamColor(t), emissive: teamColor(t), emissiveIntensity: 0.9, rim: teamHi(t), rimStrength: 0.8, flat: true }));
    core.position.y = y + 2.4; core.scale.y = 1.6; base.add(core); cores.push(core);
    if (q.outlines) { const o = new THREE.Mesh(hullGeometry(coreG), outlineMaterial(0.08)); core.add(o); }
    const light = new THREE.PointLight(teamColor(t), 40, 26, 1.6); light.position.y = y + 3; base.add(light);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 3.4, 6), toonMaterial({ color: PALETTE.lacquer, rimStrength: 0.15 }));
      pillar.position.set(Math.cos(a) * b.radius * 0.8, 2, Math.sin(a) * b.radius * 0.8); base.add(pillar);
      const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), new THREE.MeshBasicMaterial({ color: teamHi(t) }));
      flame.position.set(pillar.position.x, 3.95, pillar.position.z); base.add(flame);
    }
    group.add(base);
  }

  return {
    group, cloud,
    update(time: number) {
      cloudMat.uniforms.uTime!.value = time;
      cores.forEach((c, i) => { c.rotation.y = time * 0.6 * (i ? -1 : 1); c.position.y += Math.sin(time * 1.7 + i) * 0.004; });
    },
  };
}
