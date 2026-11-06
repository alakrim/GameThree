/**
 * Match telemetry (TWIST_BULWARKS.md §14, HEROES.md §6.6). Pure bookkeeping fed by the World;
 * never read by the simulation itself, so it cannot affect determinism. The server logs a summary at the
 * end of each match and `tools/balance` aggregates summaries across many headless bot matches.
 */
export interface HeroLedger {
  owner: string; heroId: string; team: 0 | 1; bot: boolean;
  level: number; kills: number; deaths: number; assists: number; lastHits: number;
  dmgHeroes: number; dmgUnits: number; dmgStructs: number; dmgTaken: number;
  healing: number; shielding: number; ccDealt: number;
  goldEarned: number;
  spent: { build: number; upgrade: number; send: number; item: number; repair: number };
  built: Record<string, number>;
  items: string[];
  abilityCasts: [number, number, number, number];
}

export interface MatchSummary {
  winner: 0 | 1 | null; seconds: number; waves: number;
  heroes: HeroLedger[];
  leaks: { team: 0 | 1; lane: string; unit: string; hp: number }[];
  leakHp: [number, number];
  heartHpByMinute: [number, number][];
  firstGateTowerAt: number | null;
  towersLost: [number, number];
  structuresLost: [number, number];
  rejections: Record<string, number>;
  sells: { count: number; gold: number };
  trollKills: number[];
}

type Spend = keyof HeroLedger['spent'];

export class Telemetry {
  readonly heroes = new Map<string, HeroLedger>();
  leaks: MatchSummary['leaks'] = [];
  heartHpByMinute: [number, number][] = [];
  firstGateTowerAt: number | null = null;
  towersLost: [number, number] = [0, 0];
  structuresLost: [number, number] = [0, 0];
  rejections: Record<string, number> = {};
  sells = { count: 0, gold: 0 };
  trollKills: number[] = [];

  ledger(owner: string, heroId: string, team: 0 | 1, bot: boolean): HeroLedger {
    let l = this.heroes.get(owner);
    if (!l) {
      l = { owner, heroId, team, bot, level: 1, kills: 0, deaths: 0, assists: 0, lastHits: 0, dmgHeroes: 0, dmgUnits: 0, dmgStructs: 0, dmgTaken: 0,
        healing: 0, shielding: 0, ccDealt: 0, goldEarned: 0, spent: { build: 0, upgrade: 0, send: 0, item: 0, repair: 0 }, built: {}, items: [], abilityCasts: [0, 0, 0, 0] };
      this.heroes.set(owner, l);
    }
    return l;
  }
  spend(l: HeroLedger | undefined, what: Spend, n: number) { if (l) l.spent[what] += n; }
  reject(why: string) { this.rejections[why] = (this.rejections[why] ?? 0) + 1; }

  summary(winner: 0 | 1 | null, seconds: number, waves: number): MatchSummary {
    const leakHp: [number, number] = [0, 0];
    for (const l of this.leaks) leakHp[l.team] += l.hp;
    return {
      winner, seconds: Math.round(seconds), waves, heroes: [...this.heroes.values()].map((h) => ({ ...h, items: [...h.items] })),
      leaks: this.leaks, leakHp, heartHpByMinute: this.heartHpByMinute, firstGateTowerAt: this.firstGateTowerAt,
      towersLost: this.towersLost, structuresLost: this.structuresLost, rejections: this.rejections, sells: this.sells, trollKills: this.trollKills,
    };
  }
}
