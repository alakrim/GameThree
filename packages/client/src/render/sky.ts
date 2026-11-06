import * as THREE from 'three';
import { loadHdr, loadSkyBackground } from '../assets.js';

export interface SkyResult { sunDir: THREE.Vector3; sunColor: THREE.Color; horizon: THREE.Color }

/**
 * Image-based lighting from the HDRI, sky photo as background, and the sun light aligned to the HDRI's sun
 * (brightest pixel), so shadows agree with the sky.
 */
export async function setupSky(renderer: THREE.WebGLRenderer, scene: THREE.Scene): Promise<SkyResult> {
  const [hdr, bg] = await Promise.all([loadHdr(), loadSkyBackground()]);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  bg.mapping = THREE.EquirectangularReflectionMapping;
  bg.colorSpace = THREE.SRGBColorSpace;
  scene.background = bg;
  scene.backgroundIntensity = 1;

  // Find the sun: brightest texel of the HDR (half-float or float RGBA data from RGBELoader).
  const img = hdr.image as { data: ArrayLike<number>; width: number; height: number };
  const half = img.data instanceof Uint16Array;
  const val = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(img.data[i]!) : img.data[i]!);
  let best = -1, bi = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    const l = val(i * 4) * 0.2126 + val(i * 4 + 1) * 0.7152 + val(i * 4 + 2) * 0.0722;
    if (l > best) { best = l; bi = i; }
  }
  const x = bi % img.width, row = Math.floor(bi / img.width);
  const u = (x + 0.5) / img.width, v = 1 - (row + 0.5) / img.height;
  const phi = (u - 0.5) * Math.PI * 2, theta = (v - 0.5) * Math.PI;
  let sunDir = new THREE.Vector3(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi)).normalize();
  // Keep a readable, low "golden" angle for long shadows even if the HDRI sun is high.
  if (sunDir.y > 0.62 || sunDir.y < 0.2) sunDir = new THREE.Vector3(sunDir.x, 0, sunDir.z).normalize().multiplyScalar(0.8).setY(0.5).normalize();
  // Horizon colour for fog: average a band of the sky just above the horizon.
  const hc = new THREE.Color(0, 0, 0);
  const r0 = Math.floor(img.height * 0.47);
  let n = 0;
  for (let xx = 0; xx < img.width; xx += 4) { const i = (r0 * img.width + xx) * 4; hc.r += val(i); hc.g += val(i + 1); hc.b += val(i + 2); n++; }
  hc.multiplyScalar(1 / n);
  const m = Math.max(hc.r, hc.g, hc.b) || 1;
  hc.multiplyScalar(0.82 / m);
  return { sunDir, sunColor: new THREE.Color(0xfff1dc), horizon: hc };
}
