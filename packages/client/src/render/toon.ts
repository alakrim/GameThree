import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette.js';

let gradient: THREE.DataTexture | null = null;
/** Three-band cel ramp (shadow / mid / lit) — Art Bible §5. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([70, 70, 70, 255, 165, 165, 165, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

export interface ToonOpts { color: THREE.ColorRepresentation; rim?: THREE.ColorRepresentation; rimStrength?: number; emissive?: THREE.ColorRepresentation; emissiveIntensity?: number; vertexColors?: boolean; flat?: boolean }

/** MeshToonMaterial + Fresnel rim light injected into the stock shader. */
export function toonMaterial(o: ToonOpts): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color: o.color, gradientMap: toonGradient(), vertexColors: o.vertexColors ?? false,
    emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1,
  });
  if (o.flat) (m as unknown as { flatShading: boolean }).flatShading = true;
  const rim = new THREE.Color(o.rim ?? 0xffffff);
  const strength = o.rimStrength ?? 0.35;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = { value: rim.multiplyScalar(strength) };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace('#include <dithering_fragment>', 'float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);\ngl_FragColor.rgb += uRim * smoothstep(0.35, 0.6, rimF);\n#include <dithering_fragment>');
  };
  m.customProgramCacheKey = () => `toonrim-${strength}`;
  return m;
}

const outlineMats = new Map<string, THREE.MeshBasicMaterial>();
/** Inverted-hull ink outline material (pushes vertices along smoothed normals). */
export function outlineMaterial(width: number, color: THREE.ColorRepresentation = PALETTE.ink): THREE.MeshBasicMaterial {
  const key = `${width}-${color}`;
  let m = outlineMats.get(key);
  if (m) return m;
  m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normalize(normal) * ${width.toFixed(4)};`);
  };
  m.customProgramCacheKey = () => `outline-${width}`;
  outlineMats.set(key, m);
  return m;
}

/** Hull geometry with welded vertices so hard-edged meshes still get a closed outline. */
export function hullGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const h = g.clone();
  for (const k of Object.keys(h.attributes)) if (k !== 'position') h.deleteAttribute(k);
  const merged = mergeVertices(h, 1e-3);
  merged.computeVertexNormals();
  return merged;
}

/** Mesh + its outline hull as one group. */
export function inked(geo: THREE.BufferGeometry, mat: THREE.Material, width: number, enabled = true): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo, mat);
  body.castShadow = true;
  g.add(body);
  if (enabled) g.add(new THREE.Mesh(hullGeometry(geo), outlineMaterial(width)));
  return g;
}
