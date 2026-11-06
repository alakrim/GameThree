export type Tier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  tier: Tier; dprCap: number; shadows: boolean; shadowMap: number; bloom: boolean; antialias: boolean;
  terrainSegments: number; grass: number; rimTrees: number; snow: number; fortLights: number;
}

const PRESETS: Record<Tier, QualitySettings> = {
  low: { tier: 'low', dprCap: 1, shadows: false, shadowMap: 0, bloom: false, antialias: false, terrainSegments: 128, grass: 0, rimTrees: 350, snow: 600, fortLights: 0 },
  medium: { tier: 'medium', dprCap: 1.5, shadows: true, shadowMap: 1024, bloom: true, antialias: true, terrainSegments: 192, grass: 9000, rimTrees: 900, snow: 2000, fortLights: 1 },
  high: { tier: 'high', dprCap: 2, shadows: true, shadowMap: 2048, bloom: true, antialias: true, terrainSegments: 256, grass: 22000, rimTrees: 1600, snow: 3500, fortLights: 2 },
};

/** Heuristic first guess; the runtime governor in main.ts sheds DPR/post if frame time stays high. */
export function detectTier(): Tier {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'low' || q === 'medium' || q === 'high') return q;
  const touch = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  if (touch) return cores >= 8 && mem >= 6 ? 'medium' : 'low';
  return cores >= 8 ? 'high' : 'medium';
}

export const qualityFor = (t: Tier): QualitySettings => PRESETS[t];
