/**
 * Inline SVG glyphs (24×24, stroke = currentColor) for items, statuses and roles.
 * Hand-drawn line art in the same weight as the compass/HUD frames, so it reads at 16–40 px and needs no asset fetch.
 */
const P: Record<string, string> = {
  // Items
  boots: '<path d="M8 3v9l-4 3v4h14l2-3-6-2-2-3V3z"/><path d="M8 7h4"/>',
  mantle: '<path d="M4 8c2-3 5-4 8-4s6 1 8 4l-2 12H6z"/><path d="M8 10l1.5 2M16 10l-1.5 2M12 9v3"/>',
  edge: '<path d="M5 19L17 7l2-4-4 2L3 17z"/><path d="M7 21l-4-4M14 4l6 6"/>',
  rune: '<path d="M6 3h12l-2 18H8z"/><path d="M12 7v10M12 9l3 3M12 13l-3 3"/>',
  fang: '<path d="M8 3c0 6 2 13 4 18 2-5 4-12 4-18"/><path d="M6 3h12"/><path d="M10 9h4"/>',
  ember: '<path d="M12 21c-4 0-6-3-6-6 0-4 4-6 4-11 3 2 4 5 3 8 1-1 2-2 2-4 2 2 3 4 3 7 0 3-2 6-6 6z"/>',
  ram: '<path d="M3 10h9v4H3z"/><path d="M12 8h5a4 4 0 010 8h-5z"/><path d="M15 10c1 0 2 1 2 2"/>',
  plate: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M8 9h8M8 13h8M12 9v9"/>',
  kit: '<path d="M14 4l6 6-3 3-6-6z"/><path d="M11 7L3 15v3h3l8-8"/><path d="M4 21h6"/>',
  // Status
  stun: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"/>',
  slow: '<path d="M12 3v18M5 7l14 10M5 17L19 7"/><circle cx="12" cy="12" r="2"/>',
  root: '<path d="M7 4v8c0 3 2 5 5 5s5-2 5-5V4"/><path d="M4 20c3-2 5-3 8-3s5 1 8 3"/><path d="M5 9h4M15 9h4"/>',
  haste: '<path d="M4 7h9M2 12h9M4 17h9"/><path d="M14 5l7 7-7 7"/>',
  shield: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>',
  heal: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/>',
  immune: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M8 12l3 3 5-6"/>',
  repair: '<path d="M14 4l6 6-3 3-6-6z"/><path d="M11 7L3 15v3h3l8-8"/>',
  recall: '<path d="M12 21V9"/><path d="M7 13l5-5 5 5"/><path d="M5 4h14"/>',
  // Roles
  Vanguard: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M12 7v10"/>',
  Warden: '<path d="M6 18L18 6M15 6h3v3"/><path d="M4 12l8 8M3 21l3-3"/>',
  Skirmisher: '<path d="M5 19L19 5M19 19L5 5"/>',
  Marksman: '<path d="M6 3c8 3 8 15 0 18"/><path d="M6 3v18M3 12h18M18 9l3 3-3 3"/>',
  Runecaster: '<path d="M12 2l3 7-3 13-3-13z"/><path d="M8 9h8"/>',
  Mystic: '<path d="M9 3h6v3H9zM8 6h8l-1 9H9z"/><path d="M12 15v6M12 9v3"/>',
};

export function icon(name: string, size = 20): string {
  const p = P[name] ?? '<circle cx="12" cy="12" r="8"/>';
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
