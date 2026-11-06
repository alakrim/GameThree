export type Tier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  tier: Tier; dprCap: number; shadows: boolean; bloom: boolean; outlines: boolean; antialias: boolean; terrainSegments: number;
}

const PRESETS: Record<Tier, QualitySettings> = {
  low: { tier: 'low', dprCap: 1.25, shadows: false, bloom: false, outlines: true, antialias: false, terrainSegments: 96 },
  medium: { tier: 'medium', dprCap: 1.75, shadows: false, bloom: true, outlines: true, antialias: true, terrainSegments: 160 },
  high: { tier: 'high', dprCap: 2, shadows: true, bloom: true, outlines: true, antialias: true, terrainSegments: 200 },
};

/** Heuristic first guess; the runtime governor in main.ts downgrades if frame time stays high. */
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
