/**
 * Data-driven hero & ability definitions. The simulation interprets these generically,
 * so new heroes are mostly data + (rarely) a new ability `kind`.
 * Numbers follow docs/design/HEROES.md §Balance framework.
 */
export type AbilityKind = 'dash' | 'cone' | 'projectile' | 'groundAoe' | 'selfAoe';

export interface AbilityDef {
  id: string;
  name: string;
  kind: AbilityKind;
  cooldown: number;      // seconds
  windup: number;        // seconds before the effect resolves (telegraph)
  damage: number;        // base
  damagePerLevel: number;
  range?: number;        // dash distance / cone length / projectile range / cast range
  radius?: number;       // AoE radius, projectile width
  angle?: number;        // cone half-angle (rad)
  speed?: number;        // projectile or dash speed (m/s)
  delay?: number;        // groundAoe detonation delay (s)
  stun?: number;         // s
  slow?: { pct: number; dur: number };
  allyHaste?: { pct: number; dur: number };
  /** Dash stops at and affects the first enemy it touches. */
  dashHitsFirst?: boolean;
}

export interface BasicAttackDef {
  kind: 'melee' | 'ranged';
  range: number; cooldown: number; windup: number;
  angle?: number;        // melee cone half-angle
  projSpeed?: number;
  /** Movement speed multiplier while winding up. */
  moveMul: number;
}

export interface HeroDef {
  id: string;
  name: string;
  title: string;
  role: 'Vanguard' | 'Warden' | 'Skirmisher' | 'Marksman' | 'Runecaster' | 'Mystic';
  blurb: string;
  hp: number; hpPerLevel: number;
  damage: number; damagePerLevel: number;
  speed: number;
  attack: BasicAttackDef;
  abilities: [AbilityDef, AbilityDef, AbilityDef]; // Q, E, R
}

export const HEROES: Record<string, HeroDef> = {
  hrodvar: {
    id: 'hrodvar', name: 'Hrodvar', title: 'the Antlered Warden', role: 'Warden',
    blurb: 'Shield-bearer of the high forts. Charges into the line, cleaves, and rallies allies with the war horn.',
    hp: 720, hpPerLevel: 82, damage: 52, damagePerLevel: 6, speed: 5.6,
    attack: { kind: 'melee', range: 2.8, angle: 1.1, cooldown: 0.95, windup: 0.28, moveMul: 0.55 },
    abilities: [
      { id: 'shield_rush', name: 'Shield Rush', kind: 'dash', cooldown: 9, windup: 0.08, damage: 60, damagePerLevel: 12, range: 7, speed: 24, radius: 1.1, stun: 0.8, dashHitsFirst: true },
      { id: 'reaving_cleave', name: 'Reaving Cleave', kind: 'cone', cooldown: 7, windup: 0.35, damage: 90, damagePerLevel: 15, range: 4, angle: 1.22, slow: { pct: 0.3, dur: 1.5 } },
      { id: 'horn_of_the_hearth', name: 'Horn of the Hearth', kind: 'selfAoe', cooldown: 45, windup: 0.5, damage: 120, damagePerLevel: 20, radius: 7, slow: { pct: 0.4, dur: 2 }, allyHaste: { pct: 0.3, dur: 4 } },
    ],
  },
  sigrun: {
    id: 'sigrun', name: 'Sigrun', title: 'Frostcaller', role: 'Runecaster',
    blurb: 'Rune-witch of the glacier. Lances foes from afar, slips away on the rime, and shatters the battlefield.',
    hp: 540, hpPerLevel: 62, damage: 44, damagePerLevel: 5, speed: 5.6,
    attack: { kind: 'ranged', range: 16, cooldown: 1.1, windup: 0.2, projSpeed: 30, moveMul: 0.75 },
    abilities: [
      { id: 'ice_lance', name: 'Ice Lance', kind: 'projectile', cooldown: 6, windup: 0.3, damage: 110, damagePerLevel: 18, range: 24, speed: 38, radius: 0.6, slow: { pct: 0.35, dur: 1.5 } },
      { id: 'rime_step', name: 'Rime Step', kind: 'dash', cooldown: 10, windup: 0, damage: 0, damagePerLevel: 0, range: 8, speed: 40 },
      { id: 'glacial_burst', name: 'Glacial Burst', kind: 'groundAoe', cooldown: 40, windup: 0.4, damage: 200, damagePerLevel: 30, range: 20, radius: 4.5, delay: 0.9, stun: 1 },
    ],
  },
};

export const HERO_IDS = Object.keys(HEROES);
export const DEFAULT_HERO = 'hrodvar';

// ---- Non-hero units ----------------------------------------------------------------------
export const MINION = { hp: 300, damage: 18, range: 1.5, cooldown: 1.1, windup: 0.25, speed: 3.4, aggro: 7, leash: 10 };
export const TOWER = { hp: 2600, damageVsHero: 125, damageVsMinion: 95, range: 11.5, cooldown: 1.25, boltSpeed: 26 };
export const HEART = { hp: 4200 };

// ---- Progression -------------------------------------------------------------------------
export const MAX_LEVEL = 12;
export const xpForLevel = (lvl: number) => 90 + lvl * 60; // xp needed to go from lvl -> lvl+1
export const XP = { minion: 32, heroBase: 160, heroPerLevel: 35, tower: 120, shareRadius: 14 };
export const respawnSeconds = (lvl: number) => 5 + lvl * 1.5;
/** Heroes inside their own fort regenerate this fraction of max HP per second. */
export const FORT_REGEN = 0.08;
