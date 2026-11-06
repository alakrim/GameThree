/**
 * Data-driven hero & ability definitions. The simulation interprets these generically,
 * so new heroes are mostly data + (rarely) a new ability `kind`.
 * Numbers follow docs/design/HEROES.md §Balance framework.
 */
export type AbilityKind = 'dash' | 'cone' | 'projectile' | 'groundAoe' | 'selfAoe' | 'trap';

export interface AbilityDef {
  id: string;
  name: string;
  kind: AbilityKind;
  cooldown: number;      // seconds
  windup: number;        // seconds before the effect resolves (telegraph)
  damage: number;        // base
  damagePerLevel: number;
  /** One-line description for the HUD / picker. */
  desc?: string;
  range?: number;        // dash distance / cone length / projectile range / cast range
  radius?: number;       // AoE radius, projectile width, trap trigger radius
  angle?: number;        // cone half-angle (rad)
  speed?: number;        // projectile or dash speed (m/s)
  delay?: number;        // groundAoe detonation delay (s)
  stun?: number;         // s (hard CC, subject to diminishing returns on heroes)
  root?: number;         // s (hard CC: no movement, actions allowed)
  slow?: { pct: number; dur: number };
  allyHaste?: { pct: number; dur: number };
  /** Dash stops at and affects the first enemy it touches. */
  dashHitsFirst?: boolean;
  // ---- M1c extensions ----
  /** Projectile: which heroes it can attach to. 'ally' passes through enemies; 'any' affects the first ally AND the first enemy. */
  targets?: 'enemy' | 'ally' | 'any';
  /** Projectile only collides with heroes (hooks); palisades still stop it. */
  heroOnly?: boolean;
  /** Displace the hit target toward the caster by this many metres. */
  pull?: number;
  /** Pull the target all the way to the caster (up to `pull` metres) and stun it on arrival. */
  pullToCaster?: boolean;
  /** Self AoE: push enemies outward by this many metres. */
  push?: number;
  /** Slow applied to every enemy within `r` of the impact point (hooks). */
  splashSlow?: { r: number; pct: number; dur: number };
  /** Projectile splits into two halves (each `mul` damage) at ±angle after travelling `after` metres. */
  split?: { after: number; angle: number; mul: number };
  /** Ground AoE that resolves as `count` pulses `every` seconds apart (arcing: ignores walls). */
  pulses?: { count: number; every: number };
  /** Heal for the first ally hero hit (flat + per level). */
  heal?: number; healPerLevel?: number;
  /** Shield the first ally hero hit: flat + per level + fraction of their max HP, for `dur` seconds. */
  shield?: { flat: number; perLevel: number; pct: number; dur: number };
  /** Self AoE: allies inside heal `pct` of max HP over `dur` seconds. */
  allyHot?: { pct: number; dur: number };
  /** Placed trap: arms after `arm` s, lasts `life` s, at most `max` per caster. */
  trap?: { arm: number; life: number; max: number };
  /** Damage multiplier against structures (on top of the 50% area rule). */
  structureMul?: number;
}

export interface BasicAttackDef {
  kind: 'melee' | 'ranged';
  range: number; cooldown: number; windup: number;
  angle?: number;        // melee cone half-angle
  projSpeed?: number;
  /** Movement speed multiplier while winding up. */
  moveMul: number;
  /** Every Nth landed hit reels the target `reel` metres toward the attacker. */
  reelEvery?: number; reel?: number;
}

export interface HeroDef {
  id: string;
  name: string;
  title: string;
  role: 'Vanguard' | 'Warden' | 'Skirmisher' | 'Marksman' | 'Runecaster' | 'Mystic';
  blurb: string;
  difficulty: 1 | 2 | 3;
  hp: number; hpPerLevel: number;
  damage: number; damagePerLevel: number;
  speed: number;
  attack: BasicAttackDef;
  abilities: [AbilityDef, AbilityDef, AbilityDef]; // Q, E, R
}

export const HEROES: Record<string, HeroDef> = {
  hrodvar: {
    id: 'hrodvar', name: 'Hrodvar', title: 'the Antlered Warden', role: 'Warden', difficulty: 1,
    blurb: 'Shield-bearer of the high forts. Charges into the line, cleaves, and rallies allies with the war horn.',
    hp: 720, hpPerLevel: 82, damage: 52, damagePerLevel: 6, speed: 5.6,
    attack: { kind: 'melee', range: 2.8, angle: 1.1, cooldown: 0.95, windup: 0.28, moveMul: 0.55 },
    abilities: [
      { id: 'shield_rush', name: 'Shield Rush', kind: 'dash', cooldown: 9, windup: 0.08, damage: 60, damagePerLevel: 12, range: 7, speed: 24, radius: 1.1, stun: 0.8, dashHitsFirst: true,
        desc: 'Dash 7 m. The first enemy struck is damaged and stunned. Stops at walls.' },
      { id: 'reaving_cleave', name: 'Reaving Cleave', kind: 'cone', cooldown: 7, windup: 0.35, damage: 90, damagePerLevel: 15, range: 4, angle: 1.22, slow: { pct: 0.3, dur: 1.5 },
        desc: 'Wide 4 m cleave that damages and slows.' },
      { id: 'horn_of_the_hearth', name: 'Horn of the Hearth', kind: 'selfAoe', cooldown: 45, windup: 0.5, damage: 120, damagePerLevel: 20, radius: 7, slow: { pct: 0.4, dur: 2 }, allyHaste: { pct: 0.3, dur: 4 },
        desc: 'Damage and slow enemies within 7 m; allies run 30% faster.' },
    ],
  },
  sigrun: {
    id: 'sigrun', name: 'Sigrun', title: 'Frostcaller', role: 'Runecaster', difficulty: 2,
    blurb: 'Rune-witch of the glacier. Lances foes from afar, slips away on the rime, and shatters the battlefield.',
    hp: 540, hpPerLevel: 62, damage: 44, damagePerLevel: 5, speed: 5.6,
    attack: { kind: 'ranged', range: 16, cooldown: 1.1, windup: 0.2, projSpeed: 30, moveMul: 0.75 },
    abilities: [
      { id: 'ice_lance', name: 'Ice Lance', kind: 'projectile', cooldown: 7.5, windup: 0.3, damage: 100, damagePerLevel: 17, range: 24, speed: 38, radius: 0.6, slow: { pct: 0.35, dur: 1.5 },
        desc: '24 m skillshot: heavy damage and a slow. Outranges every bulwark.' },
      { id: 'rime_step', name: 'Rime Step', kind: 'dash', cooldown: 10, windup: 0, damage: 0, damagePerLevel: 0, range: 8, speed: 40,
        desc: 'Blink-dash 8 m along your aim.' },
      { id: 'glacial_burst', name: 'Glacial Burst', kind: 'groundAoe', cooldown: 45, windup: 0.4, damage: 200, damagePerLevel: 30, range: 20, radius: 4.5, delay: 0.9, stun: 1,
        desc: 'Hold to aim. After 0.9 s the ground shatters: damage and a 1 s stun.' },
    ],
  },
  hilde: {
    id: 'hilde', name: 'Hilde', title: 'Longwatch', role: 'Marksman', difficulty: 1,
    blurb: 'A patient ridge-watcher. Splits her arrows across the line, snares the paths, and darkens the sky with winter rain.',
    hp: 520, hpPerLevel: 52, damage: 43, damagePerLevel: 6, speed: 5.6,
    attack: { kind: 'ranged', range: 17, cooldown: 1.08, windup: 0.24, projSpeed: 44, moveMul: 0.7 },
    abilities: [
      { id: 'split_shot', name: 'Split Shot', kind: 'projectile', cooldown: 8, windup: 0.25, damage: 90, damagePerLevel: 15, range: 18, speed: 44, radius: 0.45,
        split: { after: 8, angle: 0.21, mul: 0.5 },
        desc: '18 m arrow that splits in two after 8 m; each half deals half damage. Palisades stop it.' },
      { id: 'cairn_snare', name: 'Cairn Snare', kind: 'trap', cooldown: 12, windup: 0.2, damage: 40, damagePerLevel: 6, range: 12, radius: 1.1, root: 0.8,
        trap: { arm: 0.5, life: 45, max: 2 },
        desc: 'Set a snare up to 12 m away. Arms in 0.5 s; the first enemy hero to step in is rooted 0.8 s. Two at a time.' },
      { id: 'winter_rain', name: 'Winter Rain', kind: 'groundAoe', cooldown: 50, windup: 0.3, damage: 36, damagePerLevel: 6, range: 22, radius: 7, delay: 1.6,
        pulses: { count: 9, every: 0.25 }, slow: { pct: 0.3, dur: 1.5 },
        desc: 'Hold to aim, 22 m. After 1.6 s nine volleys fall over 2 s, each damaging and slowing. Arcs over walls.' },
    ],
  },
  brynna: {
    id: 'brynna', name: 'Brynna', title: 'Chainhook', role: 'Vanguard', difficulty: 2,
    blurb: 'A ferry-crew hand who hauls her quarry across the line by nerve and iron chain.',
    hp: 790, hpPerLevel: 84, damage: 48, damagePerLevel: 5, speed: 5.6,
    attack: { kind: 'melee', range: 5.5, angle: 0.2, cooldown: 1.35, windup: 0.3, moveMul: 0.55, reelEvery: 3, reel: 0.8 },
    abilities: [
      { id: 'hooked_reel', name: 'Hooked Reel', kind: 'projectile', cooldown: 10, windup: 0.22, damage: 70, damagePerLevel: 12, range: 11, speed: 30, radius: 0.5,
        heroOnly: true, pull: 4, slow: { pct: 0.25, dur: 1 },
        desc: '11 m hook that catches the first enemy hero, drags them 4 m toward you and slows them. Stopped by palisades.' },
      { id: 'chain_whirl', name: 'Chain Whirl', kind: 'selfAoe', cooldown: 8, windup: 0.3, damage: 95, damagePerLevel: 15, radius: 3.5, push: 3,
        desc: 'Whirl the chain: damage everything within 3.5 m and hurl enemies 3 m outward.' },
      { id: 'last_link', name: 'Last Link', kind: 'projectile', cooldown: 40, windup: 0.35, damage: 150, damagePerLevel: 25, range: 13, speed: 34, radius: 0.6,
        heroOnly: true, pull: 13, pullToCaster: true, stun: 1.0, splashSlow: { r: 3, pct: 0.4, dur: 2 },
        desc: '13 m grapple: haul the first enemy hero all the way to you and stun them 1 s. Enemies near them are slowed.' },
    ],
  },
  halla: {
    id: 'halla', name: 'Halla', title: 'Lanternkeep', role: 'Mystic', difficulty: 2,
    blurb: 'Keeper of the camp-lanterns. Her light mends allies, wards them in warmth, and turns the night into dawn.',
    hp: 610, hpPerLevel: 58, damage: 38, damagePerLevel: 4, speed: 5.6,
    attack: { kind: 'ranged', range: 12, cooldown: 1.3, windup: 0.22, projSpeed: 28, moveMul: 0.75 },
    abilities: [
      { id: 'lantern_beam', name: 'Lantern Beam', kind: 'projectile', cooldown: 7, windup: 0.25, damage: 60, damagePerLevel: 9, range: 14, speed: 36, radius: 0.55,
        targets: 'any', heal: 180, healPerLevel: 25,
        desc: '14 m beam of light: heals the first ally it touches and burns the first enemy.' },
      { id: 'thread_of_warmth', name: 'Thread of Warmth', kind: 'projectile', cooldown: 8, windup: 0.2, damage: 0, damagePerLevel: 0, range: 12, speed: 32, radius: 0.6,
        targets: 'ally', shield: { flat: 90, perLevel: 14, pct: 0.12, dur: 3 },
        desc: '12 m thread: the first ally hero touched gains a shield (12% of their max HP + 90) for 3 s. Passes through enemies.' },
      { id: 'dawnfire_ring', name: 'Dawnfire Ring', kind: 'selfAoe', cooldown: 45, windup: 0.45, damage: 0, damagePerLevel: 0, radius: 8,
        allyHot: { pct: 0.3, dur: 3 }, slow: { pct: 0.2, dur: 2 },
        desc: 'A ring of dawnlight 8 m wide: allies (and you) heal 30% of max HP over 3 s; enemies are slowed.' },
    ],
  },
};

export const HERO_IDS = Object.keys(HEROES);
export const DEFAULT_HERO = 'hrodvar';

// ---- Non-hero units ----------------------------------------------------------------------
export const MINION = { hp: 300, damage: 18, range: 1.5, cooldown: 1.1, windup: 0.25, speed: 3.4, aggro: 7, leash: 10 };
export const TOWER = { hp: 4000, damageVsHero: 125, damageVsMinion: 95, range: 11.5, cooldown: 1.25, boltSpeed: 26 };
export const HEART = { hp: 5000 };

// ---- Progression -------------------------------------------------------------------------
export const MAX_LEVEL = 12;
export const xpForLevel = (lvl: number) => 90 + lvl * 60; // xp needed to go from lvl -> lvl+1
export const XP = { minion: 32, heroBase: 160, heroPerLevel: 35, tower: 120, shareRadius: 14 };
export const respawnSeconds = (lvl: number) => 5 + lvl * 1.5;
/** Heroes inside their own fort regenerate this fraction of max HP per second. */
export const FORT_REGEN = 0.08;
