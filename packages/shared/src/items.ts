/**
 * Items v0 — passive gear bought at your own fort (the quartermaster's rack inside the walls).
 * Items compete with bulwarks and sends for the same gold, which is the point: every coin is a choice
 * between a stronger hero and a stronger lane. See docs/design/ITEMS.md.
 */
export type ItemId = 'boots' | 'mantle' | 'edge' | 'rune' | 'fang' | 'ember' | 'ram' | 'plate' | 'kit';

export interface ItemStats {
  hp?: number;          // flat max HP
  dmg?: number;         // flat basic-attack damage
  speed?: number;       // move-speed fraction (0.08 = +8%)
  cdr?: number;         // ability cooldown reduction fraction
  lifesteal?: number;   // fraction of basic-attack damage returned as HP
  regen?: number;       // fraction of max HP per second while out of combat
  structDmg?: number;   // bonus fraction vs. towers, bulwarks and Heartstones
  armor?: number;       // incoming damage reduction fraction
  repair?: number;      // repair speed bonus fraction (also cuts repair cost)
  power?: number;       // ability damage & healing bonus fraction
}

export interface ItemDef { id: ItemId; name: string; cost: number; blurb: string; stats: ItemStats; tag: 'offence' | 'defence' | 'utility' }

export const ITEMS: Record<ItemId, ItemDef> = {
  boots: { id: 'boots', name: 'Iron-Shod Boots', cost: 220, tag: 'utility', blurb: '+9% move speed.', stats: { speed: 0.09 } },
  mantle: { id: 'mantle', name: 'Wolfhide Mantle', cost: 280, tag: 'defence', blurb: '+220 max HP.', stats: { hp: 220 } },
  edge: { id: 'edge', name: 'Whetstone Edge', cost: 300, tag: 'offence', blurb: '+14 attack damage.', stats: { dmg: 14 } },
  rune: { id: 'rune', name: 'Rune of Swiftcasting', cost: 360, tag: 'offence', blurb: '15% shorter ability cooldowns, +8% ability power.', stats: { cdr: 0.15, power: 0.08 } },
  fang: { id: 'fang', name: 'Draugr-Fang Amulet', cost: 330, tag: 'offence', blurb: '+6 attack damage; attacks heal you for 15% of damage dealt.', stats: { dmg: 6, lifesteal: 0.15 } },
  ember: { id: 'ember', name: 'Hearth Ember', cost: 250, tag: 'defence', blurb: '+80 max HP; out of combat regenerate 1.5% max HP per second.', stats: { hp: 80, regen: 0.015 } },
  ram: { id: 'ram', name: "Sapper's Ram-Head", cost: 290, tag: 'offence', blurb: '+6 attack damage; +40% damage to towers, bulwarks and Heartstones.', stats: { dmg: 6, structDmg: 0.4 } },
  plate: { id: 'plate', name: 'Troll-Bone Plate', cost: 420, tag: 'defence', blurb: '+120 max HP; take 12% less damage.', stats: { hp: 120, armor: 0.12 } },
  kit: { id: 'kit', name: "Mason's Kit", cost: 170, tag: 'utility', blurb: '+60 max HP; repair 60% faster and 40% cheaper.', stats: { hp: 60, repair: 0.6 } },
};
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const MAX_ITEMS = 4;
export const ITEM_SELL_REFUND = 0.6;

/** Sum the stats of a loadout (stacking rules: additive, armor/cdr capped). */
export function itemStats(items: readonly string[]): Required<ItemStats> {
  const s: Required<ItemStats> = { hp: 0, dmg: 0, speed: 0, cdr: 0, lifesteal: 0, regen: 0, structDmg: 0, armor: 0, repair: 0, power: 0 };
  for (const id of items) {
    const d = ITEMS[id as ItemId]; if (!d) continue;
    for (const k of Object.keys(d.stats) as (keyof ItemStats)[]) s[k] += d.stats[k] ?? 0;
  }
  s.armor = Math.min(s.armor, 0.35); s.cdr = Math.min(s.cdr, 0.35); s.speed = Math.min(s.speed, 0.2);
  return s;
}

/** Repair: heroes channel on a friendly bulwark (not gate towers). Full repair costs `costFrac` of the gold invested. */
export const REPAIR = { range: 4.5, ratePerSec: 0.07, costFrac: 0.45, regenDelay: 4 };
/** Hard-CC diminishing returns (HEROES.md §6.4): 100%, then 50%, then 3 s immunity, within a 6 s window. */
export const DR = { window: 6, immune: 3 };
/** Hearth Recall channel time (s). */
export const RECALL_SECONDS = 4;
