/** Bulwarks (core twist: MOBA + tower defence) — data only. See docs/design/TWIST_BULWARKS.md. */
export type BulwarkType = 'arrow' | 'frost' | 'fire' | 'palisade' | 'spikes';
export const BULWARK_TYPES: BulwarkType[] = ['arrow', 'frost', 'fire', 'palisade', 'spikes'];

export interface BulwarkLevel {
  cost: number;           // build cost (L1) or upgrade cost (L2/L3)
  hp: number;
  range?: number; minRange?: number;
  damage?: number; cooldown?: number; splash?: number;
  aura?: number; slow?: number; chillDps?: number;
  trapDps?: number; charges?: number;
  burn?: { dps: number; dur: number; r: number };
}
export interface BulwarkDef { type: BulwarkType; name: string; blocks: boolean; levels: [BulwarkLevel, BulwarkLevel, BulwarkLevel]; blurb: string }

export const BULWARKS: Record<BulwarkType, BulwarkDef> = {
  arrow: { type: 'arrow', name: 'Watch Tower', blocks: true, blurb: 'Fast single-target bolts.', levels: [
    { cost: 100, hp: 700, range: 13, damage: 34, cooldown: 0.8 },
    { cost: 70, hp: 850, range: 14, damage: 52, cooldown: 0.8 },
    { cost: 120, hp: 1000, range: 15, damage: 78, cooldown: 0.7 },
  ] },
  frost: { type: 'frost', name: 'Rime Totem', blocks: true, blurb: 'Aura that slows every enemy near it.', levels: [
    { cost: 120, hp: 600, aura: 7, slow: 0.3 },
    { cost: 80, hp: 720, aura: 7, slow: 0.4 },
    { cost: 130, hp: 850, aura: 7.5, slow: 0.5, chillDps: 12 },
  ] },
  fire: { type: 'fire', name: 'Ember Catapult', blocks: true, blurb: 'Lobbed fire that splashes crowds.', levels: [
    { cost: 160, hp: 650, range: 16, minRange: 4, damage: 55, cooldown: 2.2, splash: 2.5 },
    { cost: 100, hp: 780, range: 16, minRange: 4, damage: 85, cooldown: 2.2, splash: 2.5 },
    { cost: 150, hp: 900, range: 17, minRange: 4, damage: 125, cooldown: 2.2, splash: 2.8, burn: { dps: 20, dur: 3, r: 2.5 } },
  ] },
  palisade: { type: 'palisade', name: 'Palisade', blocks: true, blurb: 'Cheap wall: maze the enemy waves.', levels: [
    { cost: 25, hp: 500 }, { cost: 25, hp: 800 }, { cost: 40, hp: 1200 },
  ] },
  spikes: { type: 'spikes', name: 'Caltrops', blocks: false, blurb: 'Walkable trap that bleeds what crosses it.', levels: [
    { cost: 40, hp: 1, trapDps: 22, charges: 140 }, { cost: 30, hp: 1, trapDps: 34, charges: 200 }, { cost: 50, hp: 1, trapDps: 50, charges: 280 },
  ] },
};

/** Total gold invested to reach a level (for sell refunds and bounties). */
export const investedIn = (type: BulwarkType, level: number) => BULWARKS[type].levels.slice(0, level).reduce((s, l) => s + l.cost, 0);

export type UnitType = 'minion' | 'wolf' | 'brute' | 'troll';
export interface UnitDef { hp: number; damage: number; speed: number; range: number; cooldown: number; radius: number; leak: number; bounty: number }
export const UNITS: Record<UnitType, UnitDef> = {
  minion: { hp: 300, damage: 18, speed: 3.4, range: 1.5, cooldown: 1.1, radius: 0.45, leak: 60, bounty: 12 },
  wolf: { hp: 160, damage: 12, speed: 5.4, range: 1.3, cooldown: 0.8, radius: 0.4, leak: 25, bounty: 6 },
  brute: { hp: 1100, damage: 45, speed: 2.8, range: 1.8, cooldown: 1.6, radius: 0.7, leak: 200, bounty: 40 },
  troll: { hp: 1800, damage: 70, speed: 2.4, range: 2.4, cooldown: 2, radius: 1.1, leak: 600, bounty: 120 },
};

export type SendType = 'wolves' | 'brute';
export const SENDS: Record<SendType, { name: string; cost: number; income: number; unit: UnitType; count: number }> = {
  wolves: { name: 'Wolf Pack', cost: 60, income: 4, unit: 'wolf', count: 3 },
  brute: { name: 'Draugr Brute', cost: 140, income: 10, unit: 'brute', count: 1 },
};

export const ECON = {
  startGold: 150, passivePerSec: 1, baseIncome: 40,
  bountyShare: 0.5, shareRadius: 14, heroBounty: 200, bulwarkBountyFrac: 0.4, gateTowerTeam: 150,
  sellRefund: 0.7, buildRange: 14, interactRange: 8, maxPerTeam: 40, territoryMargin: 10,
  /** Gold to each assisting hero on a hero kill; send income is capped (TWIST_BULWARKS §13 risk 2). */
  assistGold: 50, sendIncomeCap: 40,
  /** Structure caps (TWIST_BULWARKS §13 risk 6): each hero may own 10, and a team 40 in total — so a player joining
   *  a bot match always has their own allowance. */
  capPerHero: 10,
};

/** `stallFrom` (s): the Rimetroll tide — every wave after this adds one troll per lane, +2 more each `stallStep` s. */
export const WAVES = { interval: 30, first: 5, perLane: 4, hpGrowth: 0.08, dmgGrowth: 0.05, bossEvery: 5, bossFirst: 10, stallFrom: 18 * 60, stallStep: 3 * 60 };
/** Off-lane cells cost this much more in the minion flow field (keeps waves in their lane, mazed by walls). */
export const OFF_LANE_COST = 3;
