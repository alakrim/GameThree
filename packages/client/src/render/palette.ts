/** Locked palette — see docs/art/ART_BIBLE.md §4. Never hard-code colors elsewhere. */
export const PALETTE = {
  dawn: 0xf2a541, dawnHi: 0xffd58a,
  dusk: 0x3fc1c9, duskHi: 0xa8f0f2,
  hostile: 0xe8457a, neutral: 0x7fb069,
  cloudDeep: 0x1e2240, cloudHi: 0x3a4170,
  stone: 0x8c8577, moss: 0x5e7a4a, lacquer: 0x9e3b2e, gold: 0xc9a24b,
  ink: 0x14121c, keyLight: 0xffe6bf, skyFill: 0x6f7fd6, groundFill: 0x2b2438,
} as const;

export const teamColor = (t: 0 | 1) => (t === 0 ? PALETTE.dawn : PALETTE.dusk);
export const teamHi = (t: 0 | 1) => (t === 0 ? PALETTE.dawnHi : PALETTE.duskHi);
