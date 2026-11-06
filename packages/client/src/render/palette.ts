/** Locked palette — docs/art/ART_BIBLE.md §4 ("Frost & Hearthfire"). */
export const PALETTE = {
  dawn: 0xe07a2e, dawnBanner: 0x7a2f1e,   // Hearthguard — ember
  dusk: 0x4fa3d9, duskBanner: 0x2c4660,   // Rimewardens — glacial
  hostile: 0xe8457a, neutral: 0x7fb069,
  fire: 0xffa24a, rune: 0xfff0c8,
} as const;
export const teamColor = (t: 0 | 1) => (t === 0 ? PALETTE.dawn : PALETTE.dusk);
export const teamBanner = (t: 0 | 1) => (t === 0 ? PALETTE.dawnBanner : PALETTE.duskBanner);
