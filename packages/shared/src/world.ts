import { DT, TICK_RATE } from './constants.js';
import { type MapDef, type Team, type LaneId, createMap } from './map.js';
import { NavGrid } from './nav.js';
import { type Vec2, dist, clamp, angleDelta } from './math.js';
import type { Command, EntitySnapshot, Snapshot, GameEvent } from './protocol.js';
import { moveWithCollision, sanitizeInput } from './movement.js';
import {
  HEROES, DEFAULT_HERO, MINION, TOWER, HEART, MAX_LEVEL, XP, xpForLevel, respawnSeconds, FORT_REGEN,
  type HeroDef, type AbilityDef,
} from './heroes.js';
import { BotBrain } from './bot.js';
import { BULWARKS, UNITS, SENDS, ECON, WAVES, OFF_LANE_COST, investedIn, BULWARK_TYPES, type BulwarkType, type UnitType, type SendType } from './bulwarks.js';
import { distToPolyline } from './math.js';
import { FORT_WALL_R } from './map.js';
import { ITEMS, MAX_ITEMS, ITEM_SELL_REFUND, REPAIR, DR, RECALL_SECONDS, itemStats, type ItemId, type ItemStats } from './items.js';
import { Telemetry, type HeroLedger, type MatchSummary } from './telemetry.js';

export type EntityKind = 'hero' | 'minion' | 'tower' | 'heart' | 'projectile' | 'bulwark' | 'trap';

/** An in-progress attack or ability (windup -> resolve). */
interface Action { slot: number; ticks: number; aim: number; tx: number; ty: number }
interface Dash { dx: number; dy: number; ticks: number; ability: AbilityDef; hit: boolean }
interface Projectile {
  owner: number; vx: number; vy: number; life: number; dmg: number; width: number; ability?: AbilityDef; homing?: number;
  /** Metres flown (split shots); which halves of an ally/enemy ('any') beam have been spent. */
  flown: number; doneAlly?: boolean; doneEnemy?: boolean; noSplit?: boolean;
}
interface PendingAoe { owner: number; team: Team; x: number; y: number; ticks: number; ability?: AbilityDef; dmg: number; r?: number; burn?: { dps: number; dur: number; r: number }; pulsesLeft?: number }
/** Forced movement (pulls, pushes, reels): the victim cannot act or steer until it ends. */
interface Forced { dx: number; dy: number; ticks: number; stun?: number; src?: number }
interface Hot { per: number; ticks: number; src: number }
interface Trap { owner: number; arm: number; life: number; ability: AbilityDef; dmg: number }
interface Burn { owner: number; team: Team; x: number; y: number; r: number; dps: number; ticks: number }

export interface Entity {
  id: number;
  kind: EntityKind;
  team: Team;
  pos: Vec2;
  facing: number;
  radius: number;
  speed: number;
  hp: number;
  maxHp: number;
  path: Vec2[];
  moving: boolean;
  // Combat
  damage: number;
  atkTicks: number;          // ticks until basic attack ready
  target?: number;           // AI target id
  stunTicks: number;
  slowTicks: number; slowPct: number;
  hasteTicks: number; hastePct: number;
  invulnerable?: boolean;
  lastHitBy?: number;
  // Minions
  lane?: LaneId; laneIdx?: number;
  // Towers
  tier?: 1 | 2;
  // Heroes
  owner?: string;
  heroId?: string;
  bot?: boolean;
  level?: number; xp?: number;
  cds?: number[];            // ticks remaining: [basic, Q, E, R]
  action?: Action;
  dash?: Dash;
  deadTicks?: number;        // > 0 while dead (respawn countdown)
  inputs?: { seq: number; mx: number; my: number }[];
  input?: { mx: number; my: number };
  lastSeq?: number;
  starve?: number;
  // Economy (heroes)
  gold?: number; income?: number;
  // Wave units (minions, wolves, brutes, trolls)
  unit?: UnitType;
  // Player-built structures
  bw?: { type: BulwarkType; level: number; owner: string; cells: number[]; charges: number };
  // Projectiles
  proj?: Projectile;
  fx?: string;               // visual id for projectiles
  // ---- M1c: status, items, repair, traps, kill tracking ----
  rootTicks?: number;
  shieldHp?: number; shieldTicks?: number;
  hots?: Hot[];
  forced?: Forced;
  drStart?: number; drCount?: number; drImmune?: number;  // hard-CC diminishing returns (ticks)
  items?: string[]; ist?: Required<ItemStats>;
  basicHits?: number;
  repair?: number;            // id of the bulwark being repaired
  recall?: number;            // ticks of Hearth Recall channel remaining
  lastCombat?: number;        // tick of the last damage dealt or taken
  dmgBy?: Map<number, number>; // enemy hero id -> last tick it damaged us (assists)
  kills?: number; deaths?: number;
  trap?: Trap;
}

export const HERO_SPEED = 5.6;
const MAX_INPUT_BUFFER = 8;
/** Repeat the last input for at most this many ticks without new input (covers jitter, stops runaway heroes). */
export const INPUT_STARVE_TICKS = 6;
const T = (s: number) => Math.max(0, Math.round(s * TICK_RATE));

export interface WorldOptions { seed?: number; minionWaves?: boolean; waveInterval?: number; botsPerTeam?: number; structures?: boolean }

/**
 * Authoritative, deterministic simulation. Pure TypeScript, no I/O:
 * runs identically inside the Node server, a browser (offline practice), or tests.
 */
export class World {
  readonly map: MapDef;
  readonly nav: NavGrid;
  tick = 0;
  winner: Team | null = null;
  private overTicks = 0;
  private nextId = 1;
  readonly entities = new Map<number, Entity>();
  private pending: { playerId: string; cmd: Command }[] = [];
  private aoes: PendingAoe[] = [];
  private events: GameEvent[] = [];
  private bots = new Map<string, BotBrain>();
  wave = 0;
  private matchStart = 0;
  private burns: Burn[] = [];
  /** Per attacking team, per lane: queued send units for that team's next wave. */
  private sendQueue: Record<Team, Record<LaneId, UnitType[]>> = { 0: { top: [], mid: [], bot: [] }, 1: { top: [], mid: [], bot: [] } };
  private flow: Partial<Record<string, Float32Array>> = {};
  private flowDirty = true;
  /** Fields awaiting rebuild ("attacker:lane"); at most one is rebuilt per tick to keep ticks flat. */
  private dirtyFields = new Set<string>();
  private laneMask: Record<LaneId, Uint8Array> | null = null;
  private heartGoals: Record<Team, number[]> = { 0: [], 1: [] };
  private botSeq = 0;
  private readonly opts: Required<WorldOptions>;
  /** Per-match telemetry (reset with the match). `lastSummary` holds the previous match's report. */
  telemetry = new Telemetry();
  lastSummary: MatchSummary | null = null;
  /** Called once when a match ends (server logging, balance tools). */
  onMatchEnd?: (s: MatchSummary) => void;

  constructor(opts: WorldOptions = {}) {
    this.opts = { seed: 1337, minionWaves: true, waveInterval: 30, botsPerTeam: 0, structures: true, ...opts };
    this.map = createMap(this.opts.seed);
    this.nav = new NavGrid(this.map);
    if (this.opts.structures) this.spawnStructures();
    this.prepareFlow();
  }

  // ---- Players ------------------------------------------------------------------------------

  spawnHero(owner: string, team: Team, heroId = DEFAULT_HERO, bot = false): Entity {
    const def = HEROES[heroId] ?? HEROES[DEFAULT_HERO]!;
    const e = this.add({
      kind: 'hero', team, pos: this.spawnPoint(team), facing: team === 0 ? Math.PI / 4 : -3 * Math.PI / 4,
      radius: 0.55, speed: def.speed, hp: def.hp, maxHp: def.hp, path: [], moving: false, damage: def.damage,
      atkTicks: 0, stunTicks: 0, slowTicks: 0, slowPct: 0, hasteTicks: 0, hastePct: 0,
      owner, heroId: def.id, bot, level: 1, xp: 0, cds: [0, 0, 0, 0], gold: ECON.startGold, income: ECON.baseIncome, inputs: [], input: { mx: 0, my: 0 }, lastSeq: 0, starve: 0,
      items: [], ist: itemStats([]), kills: 0, deaths: 0, basicHits: 0, dmgBy: new Map(), rootTicks: 0, hots: [],
    });
    this.telemetry.ledger(owner, def.id, team, bot);
    return e;
  }

  removeOwner(owner: string): void {
    for (const [id, e] of this.entities) if (e.owner === owner) this.entities.delete(id);
    this.bots.delete(owner);
  }

  /** Top each team up to `botsPerTeam` heroes with AI; remove surplus bots when humans join. */
  fillBots(perTeam = this.opts.botsPerTeam): void {
    for (const team of [0, 1] as const) {
      const heroes = [...this.entities.values()].filter((e) => e.kind === 'hero' && e.team === team);
      let surplus = heroes.length - perTeam;
      for (const h of heroes) if (surplus > 0 && h.bot) { this.removeOwner(h.owner!); surplus--; }
      const lanes: LaneId[] = ['mid', 'top', 'bot', 'mid', 'top'];
      for (let n = heroes.length - Math.max(0, heroes.length - perTeam); n < perTeam; n++) {
        const id = `bot:${team}:${++this.botSeq}`;
        const heroId = this.botHeroFor(team, n);
        this.spawnHero(id, team, heroId, true);
        this.bots.set(id, new BotBrain(id, lanes[n % lanes.length]!));
      }
      this.assignBotLanes(team);
    }
  }

  /** Bots fill out a team composition: frontline, ranged damage and support first, avoiding duplicates on a team. */
  private botHeroFor(team: Team, slot: number): string {
    const taken = new Set([...this.entities.values()].filter((e) => e.kind === 'hero' && e.team === team).map((e) => e.heroId));
    const pref = team === 0 ? ['hrodvar', 'sigrun', 'halla', 'brynna', 'hilde'] : ['brynna', 'hilde', 'halla', 'hrodvar', 'sigrun'];
    // Rotate by seed so offline matches see different line-ups.
    const off = (this.opts.seed + slot) % pref.length;
    const order = [...pref.slice(off), ...pref.slice(0, off)];
    return order.find((h) => !taken.has(h) && HEROES[h]) ?? order[0]!;
  }

  /** Force a bot roster (tests / balance tooling): replaces the hero ids of existing bots on `team`, in order. */
  setBotHeroes(team: Team, heroIds: string[]): void {
    const bots = [...this.entities.values()].filter((e) => e.kind === 'hero' && e.team === team && e.bot);
    bots.forEach((b, i) => {
      const id = heroIds[i]; if (!id || !HEROES[id]) return;
      const lane = this.bots.get(b.owner!)!.lane;
      this.entities.delete(b.id); this.telemetry.heroes.delete(b.owner!);
      this.spawnHero(b.owner!, team, id, true);
      this.bots.set(b.owner!, new BotBrain(b.owner!, lane));
    });
    this.assignBotLanes(team);
  }

  /**
   * Lane assignment for a team's bots: a Mystic duos with the team's ranged carry (or holds mid);
   * everyone else spreads over the remaining lanes, mid first.
   */
  private assignBotLanes(team: Team): void {
    const bots = [...this.entities.values()].filter((e) => e.kind === 'hero' && e.team === team && e.bot).sort((a, b) => a.id - b.id);
    const role = (e: Entity) => HEROES[e.heroId!]!.role;
    const free: LaneId[] = ['mid', 'top', 'bot'];
    const humans = [...this.entities.values()].filter((e) => e.kind === 'hero' && e.team === team && !e.bot).length;
    free.splice(0, Math.min(humans, 2)); // humans roam; leave them the central lanes
    if (!free.length) free.push('mid');
    const supports = bots.filter((b) => role(b) === 'Mystic'), others = bots.filter((b) => role(b) !== 'Mystic');
    others.forEach((b, i) => { this.bots.get(b.owner!)!.lane = free[i % free.length]!; });
    const carry = others.find((b) => role(b) === 'Marksman' || role(b) === 'Runecaster') ?? others[0];
    for (const s of supports) this.bots.get(s.owner!)!.lane = carry ? this.bots.get(carry.owner!)!.lane : 'mid';
  }

  queue(playerId: string, cmd: Command): void { this.pending.push({ playerId, cmd }); }

  /** Seconds since the current match started. */
  get matchSeconds(): number { return Math.max(0, (this.tick - this.matchStart) / TICK_RATE); }

  heroOf(playerId: string): Entity | undefined {
    for (const e of this.entities.values()) if (e.owner === playerId) return e;
    return undefined;
  }

  // ---- Main loop ----------------------------------------------------------------------------

  step(): void {
    if (this.winner !== null) {
      if (--this.overTicks <= 0) this.resetMatch();
      this.tick++;
      return;
    }
    for (const b of this.bots.values()) b.think(this);
    this.applyCommands();
    if (this.flowDirty) this.rebuildFlow();
    else if (this.dirtyFields.size) { const k = this.dirtyFields.values().next().value!; this.dirtyFields.delete(k); this.rebuildField(k); }
    if (this.opts.minionWaves) this.spawnWaves();
    if (this.tick % TICK_RATE === 0) for (const e of this.entities.values()) if (e.kind === 'hero') this.earn(e, ECON.passivePerSec);
    if ((this.tick - this.matchStart) % (TICK_RATE * 60) === 0) this.sampleHearts();
    for (const e of [...this.entities.values()]) {
      if (!this.entities.has(e.id)) continue;
      this.tickStatus(e);
      switch (e.kind) {
        case 'hero': this.stepHero(e); break;
        case 'minion': this.stepMinion(e); break;
        case 'tower': this.stepTower(e); break;
        case 'projectile': this.stepProjectile(e); break;
        case 'bulwark': this.stepBulwark(e); break;
        case 'trap': this.stepTrap(e); break;
      }
    }
    this.stepAoes();
    this.stepBurns();
    this.separate();
    this.tick++;
  }

  snapshot(): Snapshot {
    const ents: EntitySnapshot[] = [];
    for (const e of this.entities.values()) {
      const s: EntitySnapshot = {
        id: e.id, k: KIND_CODE[e.kind], t: e.team, x: round2(e.pos.x), y: round2(e.pos.y), f: round2(e.facing),
        hp: Math.ceil(e.hp), mh: e.maxHp, m: e.moving ? 1 : 0,
      };
      let st = 0;
      if (e.stunTicks > 0) st |= 1;
      if (e.slowTicks > 0) st |= 2;
      if (e.deadTicks) st |= 4;
      if (e.hasteTicks > 0) st |= 8;
      if (e.invulnerable && e.kind !== 'trap') st |= 16;
      if (e.dash) st |= 32;
      if ((e.rootTicks ?? 0) > 0) st |= 64;
      if ((e.shieldHp ?? 0) > 0) { st |= 128; s.sh = Math.ceil(e.shieldHp!); }
      if (e.hots?.length) st |= 256;
      if (e.forced) st |= 512;
      if (e.repair !== undefined) { st |= 1024; s.rp = e.repair; }
      if (e.recall !== undefined) { st |= 8192; s.rc = round2(1 - e.recall / T(RECALL_SECONDS)); }
      if (e.drImmune !== undefined && this.tick < e.drImmune) st |= 2048;
      if (e.trap && e.trap.arm <= 0) st |= 4096;
      if (st) s.st = st;
      if (e.kind === 'hero') {
        s.o = e.owner; s.h = e.heroId; s.sq = e.lastSeq; s.lv = e.level;
        s.xp = round2((e.xp ?? 0) / xpForLevel(e.level ?? 1));
        s.cd = e.cds!.map((c) => Math.ceil(c / 3)); // tenths of a second
        s.sm = round2(this.speedMul(e));
        if (e.deadTicks) s.rs = Math.ceil(e.deadTicks / TICK_RATE);
        s.g = Math.floor(e.gold ?? 0); s.inc = e.income;
        if (e.items?.length) s.it = e.items;
        s.kd = [e.kills ?? 0, e.deaths ?? 0];
      }
      if (e.trap) s.o = e.owner;
      // Chain-drawn and ally-attach projectiles name their caster so clients can tether the visual to the hand.
      if (e.proj?.ability && (e.proj.ability.heroOnly || e.proj.ability.targets)) s.o = this.entities.get(e.proj.owner)?.owner;
      if (e.unit && e.unit !== 'minion') s.u = e.unit;
      if (e.bw) { s.b = BULWARK_TYPES.indexOf(e.bw.type); s.lv = e.bw.level; s.o = e.bw.owner; }
      if (e.kind === 'tower') s.tr = e.tier;
      if (e.fx) s.fx = e.fx;
      ents.push(s);
    }
    const snap: Snapshot = { tick: this.tick, ents, ev: this.events, wv: this.wave, nw: Math.ceil(this.ticksToNextWave() / TICK_RATE), mt: Math.max(0, Math.floor((this.tick - this.matchStart) / TICK_RATE)) };
    if (this.winner !== null) snap.win = this.winner;
    this.events = [];
    return snap;
  }

  /** Cheap state hash for determinism tests and desync detection. */
  hash(): number {
    let h = 2166136261 >>> 0;
    const mix = (v: number) => { h ^= Math.round(v * 1000) | 0; h = Math.imul(h, 16777619) >>> 0; };
    mix(this.tick);
    for (const e of [...this.entities.values()].sort((a, b) => a.id - b.id)) { mix(e.id); mix(e.pos.x); mix(e.pos.y); mix(e.hp); }
    return h;
  }

  // ---- Commands -----------------------------------------------------------------------------

  private applyCommands(): void {
    const cmds = this.pending; this.pending = [];
    for (const { playerId, cmd } of cmds) {
      const hero = this.heroOf(playerId);
      if (!hero) continue;
      switch (cmd.type) {
        case 'move': {
          const tx = clamp(cmd.x, -this.map.half, this.map.half), ty = clamp(cmd.y, -this.map.half, this.map.half);
          hero.path = this.nav.findPath(hero.pos, { x: tx, y: ty }) ?? [];
          hero.moving = hero.path.length > 0;
          break;
        }
        case 'stop': hero.path = []; hero.moving = false; hero.input = { mx: 0, my: 0 }; break;
        case 'input': {
          if (cmd.seq <= (hero.lastSeq ?? 0)) break; // stale / replayed
          const [mx, my] = sanitizeInput(cmd.mx, cmd.my);
          hero.inputs!.push({ seq: cmd.seq, mx, my });
          if (hero.inputs!.length > MAX_INPUT_BUFFER) hero.inputs!.splice(0, hero.inputs!.length - MAX_INPUT_BUFFER);
          break;
        }
        case 'act': this.tryAct(hero, cmd.slot, cmd.aim, cmd.tx, cmd.ty); break;
        case 'build': { const why = this.tryBuild(hero, cmd.kind, cmd.x, cmd.y); if (why) this.deny(hero, why); break; }
        case 'upgrade': { const why = this.tryUpgrade(hero, cmd.id); if (why) this.deny(hero, why); break; }
        case 'sell': { const why = this.trySell(hero, cmd.id); if (why) this.deny(hero, why); break; }
        case 'send': { const why = this.trySend(hero, cmd.unit, cmd.lane); if (why) this.deny(hero, why); break; }
        case 'repair': { const why = this.tryRepair(hero, cmd.id); if (why) this.deny(hero, why); break; }
        case 'buy': { const why = this.tryBuy(hero, cmd.item); if (why) this.deny(hero, why); break; }
        case 'sellItem': { const why = this.trySellItem(hero, cmd.slot); if (why) this.deny(hero, why); break; }
        case 'recall': {
          if (hero.deadTicks || hero.stunTicks > 0 || hero.forced || this.inOwnFort(hero)) break;
          hero.recall = T(RECALL_SECONDS); hero.repair = undefined; hero.path = [];
          this.events.push({ e: 'recall', s: hero.id });
          break;
        }
      }
    }
  }

  private deny(h: Entity, why: string): void { this.events.push({ e: 'deny', s: h.id, why }); this.telemetry.reject(why); }
  private ledger(h: Entity | undefined): HeroLedger | undefined { return h?.kind === 'hero' ? this.telemetry.heroes.get(h.owner!) : undefined; }
  /** Credit gold to a hero (all income flows through here for telemetry). */
  private earn(h: Entity, n: number): void { h.gold! += n; const l = this.ledger(h); if (l) l.goldEarned += n; }

  /** Server-side validation of attack/ability requests: alive, not stunned/busy, cooldown ready, finite aim. */
  private tryAct(e: Entity, slot: number, aim: number, tx?: number, ty?: number): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot > 3 || !Number.isFinite(aim)) return false;
    if (e.deadTicks || e.stunTicks > 0 || e.forced || e.action || e.dash || e.cds![slot]! > 0) return false;
    const def = HEROES[e.heroId!]!;
    const ab = slot > 0 ? def.abilities[slot - 1]! : undefined;
    if (ab?.kind === 'dash' && (e.rootTicks ?? 0) > 0) return false; // rooted: no dashing out
    const windup = ab ? ab.windup : def.attack.windup;
    let px = Number.isFinite(tx) ? tx! : e.pos.x, py = Number.isFinite(ty) ? ty! : e.pos.y;
    if (ab && (ab.kind === 'groundAoe' || ab.kind === 'trap')) { // clamp target to cast range
      const d = Math.hypot(px - e.pos.x, py - e.pos.y), r = ab.range ?? 0;
      if (d > r) { px = e.pos.x + ((px - e.pos.x) / d) * r; py = e.pos.y + ((py - e.pos.y) / d) * r; }
    }
    e.repair = undefined; e.recall = undefined; // acting breaks channels
    e.action = { slot, ticks: T(windup), aim, tx: px, ty: py };
    e.cds![slot] = ab ? T(ab.cooldown * (1 - (e.ist?.cdr ?? 0))) : T(def.attack.cooldown);
    e.facing = aim;
    this.events.push({ e: 'act', s: e.id, a: slot, y: round2(aim) });
    const l = this.ledger(e); if (l) l.abilityCasts[slot]!++;
    if (ab?.kind === 'groundAoe') {
      const lead = ab.windup + (ab.delay ?? 0);
      this.events.push({ e: 'tele', s: e.id, x: round2(px), y: round2(py), r: ab.radius ?? 1, d: round2(ab.pulses ? lead + ab.pulses.every * (ab.pulses.count - 1) : lead) });
    }
    if (e.action.ticks === 0) this.resolveAction(e);
    return true;
  }

  // ---- Heroes -------------------------------------------------------------------------------

  private stepHero(e: Entity): void {
    for (let i = 0; i < 4; i++) if (e.cds![i]! > 0) e.cds![i]!--;
    if (e.deadTicks) {
      if (--e.deadTicks === 0) this.respawn(e);
      e.inputs!.length = 0;
      return;
    }
    if (this.inOwnFort(e)) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * FORT_REGEN * DT);
    else if (e.ist!.regen > 0 && this.tick - (e.lastCombat ?? -1e9) > T(REPAIR.regenDelay)) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * e.ist!.regen * DT);
    if (e.action && (e.stunTicks > 0 || e.forced)) e.action = undefined; // stuns and displacement interrupt
    if (e.action && --e.action.ticks <= 0) this.resolveAction(e);
    if (e.forced) { this.stepForced(e); this.consumeInput(e); return; }
    if (e.dash) { this.stepDash(e); this.consumeInput(e); return; }
    const next = this.consumeInput(e);
    if (e.stunTicks > 0) { e.moving = false; e.repair = undefined; e.recall = undefined; return; }
    if (e.repair !== undefined) this.stepRepair(e);
    if (e.recall !== undefined && next.mx === 0 && next.my === 0 && --e.recall <= 0) {
      e.recall = undefined;
      e.pos = this.spawnPoint(e.team, e.id); e.path = [];
      this.events.push({ e: 'recall', s: e.id, done: 1 });
      return;
    }
    const { mx, my } = next;
    if ((e.rootTicks ?? 0) > 0) { e.moving = false; e.path = []; return; }
    if (mx === 0 && my === 0) {
      if (e.path.length) this.integrate(e); else e.moving = false;
      return;
    }
    e.repair = undefined; e.recall = undefined; // walking away ends channels
    e.path = [];
    const sp = e.speed * this.speedMul(e) * DT;
    e.pos = moveWithCollision(this.nav, e.pos, mx * sp, my * sp);
    if (!e.action) e.facing = Math.atan2(my, mx);
    e.moving = true;
  }

  /** Consume one buffered input (or repeat the last for a few ticks), returning the movement vector to apply. */
  private consumeInput(e: Entity): { mx: number; my: number } {
    const next = e.inputs!.shift();
    if (next) { e.input = { mx: next.mx, my: next.my }; e.lastSeq = next.seq; e.starve = 0; }
    else if (++e.starve! > INPUT_STARVE_TICKS) e.input = { mx: 0, my: 0 };
    return e.input!;
  }

  /** Combined movement multiplier from slows, hastes and attack wind-up. Shared with client prediction via snapshot. */
  speedMul(e: Entity): number {
    let m = 1;
    if (e.slowTicks > 0) m *= 1 - e.slowPct;
    if (e.hasteTicks > 0) m *= 1 + e.hastePct;
    if (e.kind === 'hero') {
      m *= 1 + (e.ist?.speed ?? 0);
      if (e.action) m *= e.action.slot === 0 ? HEROES[e.heroId!]!.attack.moveMul : 0.5;
      if ((e.rootTicks ?? 0) > 0) m = 0;
    }
    return m;
  }

  private resolveAction(e: Entity): void {
    const a = e.action!; e.action = undefined;
    const def = HEROES[e.heroId!]!;
    const lvl = (e.level ?? 1) - 1;
    const dx = Math.cos(a.aim), dy = Math.sin(a.aim);
    if (a.slot === 0) {
      const atk = def.attack, dmg = e.damage;
      if (atk.kind === 'melee') {
        const hits = this.enemiesInCone(e, a.aim, atk.range, atk.angle ?? 1);
        for (const t of hits) this.damage(t, dmg, e, 0);
        if (hits.length && atk.reelEvery && ++e.basicHits! % atk.reelEvery === 0) {
          // Every Nth landed jab reels its targets in (Brynna's chain).
          for (const t of hits) if (t.hp > 0 && (t.kind === 'hero' || t.kind === 'minion')) {
            this.displace(t, e.pos, -(atk.reel ?? 0.5), 16, undefined, e.id);
            this.events.push({ e: 'hook', s: e.id, d: t.id, r: 1 });
          }
        }
      } else {
        this.spawnProjectile(e, a.aim, atk.projSpeed ?? 30, atk.range, dmg, 0.35, undefined, `${def.id}_basic`);
      }
      return;
    }
    const ab = def.abilities[a.slot - 1]!;
    const power = 1 + (e.ist?.power ?? 0);
    const dmg = (ab.damage + ab.damagePerLevel * lvl) * power;
    switch (ab.kind) {
      case 'cone':
        for (const t of this.enemiesInCone(e, a.aim, ab.range ?? 3, ab.angle ?? 1)) this.applyAbility(t, ab, dmg, e);
        break;
      case 'projectile':
        this.spawnProjectile(e, a.aim, ab.speed ?? 30, ab.range ?? 20, dmg, ab.radius ?? 0.5, ab, ab.id);
        break;
      case 'dash': {
        const ticks = Math.max(1, Math.round(((ab.range ?? 6) / (ab.speed ?? 20)) * TICK_RATE));
        const step = (ab.range ?? 6) / ticks;
        e.dash = { dx: dx * step, dy: dy * step, ticks, ability: ab, hit: false };
        break;
      }
      case 'selfAoe': {
        const r = ab.radius ?? 5;
        for (const t of [...this.entities.values()]) {
          if (!this.targetable(t) || dist(t.pos, e.pos) > r + t.radius) continue;
          if (t.team !== e.team) {
            this.applyAbility(t, ab, dmg, e, true);
            if (ab.push && t.hp > 0 && (t.kind === 'hero' || t.kind === 'minion')) this.displace(t, e.pos, ab.push, 18, undefined, e.id);
          } else if (t.kind === 'hero') {
            if (ab.allyHaste) { t.hasteTicks = T(ab.allyHaste.dur); t.hastePct = ab.allyHaste.pct; }
            if (ab.allyHot) {
              const ticks = T(ab.allyHot.dur);
              t.hots!.push({ per: (t.maxHp * ab.allyHot.pct * power) / ticks, ticks, src: e.id });
            }
          }
        }
        this.events.push({ e: 'aoe', s: e.id, x: round2(e.pos.x), y: round2(e.pos.y), r, fx: ab.id });
        if (ab.push) this.events.push({ e: 'push', s: e.id, x: round2(e.pos.x), y: round2(e.pos.y), r });
        break;
      }
      case 'groundAoe':
        this.aoes.push({ owner: e.id, team: e.team, x: a.tx, y: a.ty, ticks: T(ab.delay ?? 0.5), ability: ab, dmg, pulsesLeft: ab.pulses?.count });
        break;
      case 'trap': {
        const at = this.nav.nearestWalkable({ x: a.tx, y: a.ty }) ?? { ...e.pos };
        const mine = [...this.entities.values()].filter((t) => t.kind === 'trap' && t.trap!.owner === e.id).sort((p, q) => p.id - q.id);
        while (mine.length >= (ab.trap?.max ?? 2)) { const old = mine.shift()!; this.entities.delete(old.id); this.events.push({ e: 'die', s: 0, d: old.id }); }
        this.add({ kind: 'trap', team: e.team, pos: { x: at.x, y: at.y }, facing: a.aim, radius: ab.radius ?? 1, speed: 0, hp: 1, maxHp: 1, path: [], moving: false,
          damage: dmg, atkTicks: 0, stunTicks: 0, slowTicks: 0, slowPct: 0, hasteTicks: 0, hastePct: 0, invulnerable: true, owner: e.owner,
          trap: { owner: e.id, arm: T(ab.trap?.arm ?? 0.5), life: T(ab.trap?.life ?? 30), ability: ab, dmg } });
        break;
      }
    }
  }

  /** Forced movement: shove `t` away from `from` by `meters` (negative = toward it) at `speed` m/s. Walls stop it. */
  private displace(t: Entity, from: Vec2, meters: number, speed: number, stunOnEnd?: number, src?: number): void {
    if (t.unit === 'troll' || t.kind === 'tower' || t.kind === 'bulwark' || t.kind === 'heart' || meters === 0) return;
    const d = Math.max(1e-6, dist(t.pos, from));
    const sgn = Math.sign(meters), m = Math.abs(meters);
    const ux = ((t.pos.x - from.x) / d) * sgn, uy = ((t.pos.y - from.y) / d) * sgn;
    const ticks = Math.max(1, Math.round((m / speed) * TICK_RATE));
    t.forced = { dx: (ux * m) / ticks, dy: (uy * m) / ticks, ticks, stun: stunOnEnd, src };
    t.action = undefined; t.dash = undefined; t.repair = undefined; t.recall = undefined; t.path = [];
  }

  private stepForced(e: Entity): void {
    const f = e.forced!;
    const next = moveWithCollision(this.nav, e.pos, f.dx, f.dy);
    const blocked = Math.hypot(next.x - e.pos.x, next.y - e.pos.y) < Math.hypot(f.dx, f.dy) * 0.25;
    e.pos = next; e.moving = true;
    if (--f.ticks <= 0 || blocked) {
      e.forced = undefined;
      if (f.stun) this.applyCc(e, 'stun', f.stun, f.src !== undefined ? this.entities.get(f.src) : undefined);
    }
  }

  private stepDash(e: Entity): void {
    const d = e.dash!;
    const next = moveWithCollision(this.nav, e.pos, d.dx, d.dy);
    const blocked = next.x === e.pos.x && next.y === e.pos.y;
    e.pos = next; e.moving = true;
    e.facing = Math.atan2(d.dy, d.dx);
    if (d.ability.dashHitsFirst && !d.hit) {
      for (const t of this.entities.values()) {
        if (t.team === e.team || !this.targetable(t) || t.kind === 'projectile') continue;
        if (dist(t.pos, e.pos) <= t.radius + (d.ability.radius ?? 1)) {
          d.hit = true;
          this.applyAbility(t, d.ability, d.ability.damage + d.ability.damagePerLevel * ((e.level ?? 1) - 1), e);
          e.dash = undefined; // stop on impact
          return;
        }
      }
    }
    if (--d.ticks <= 0 || blocked) e.dash = undefined;
  }

  private respawn(e: Entity): void {
    e.pos = this.spawnPoint(e.team, e.id);
    e.hp = e.maxHp; e.deadTicks = 0; e.stunTicks = e.slowTicks = e.hasteTicks = 0; e.rootTicks = 0;
    e.shieldHp = 0; e.shieldTicks = 0; e.hots = []; e.forced = undefined; e.repair = undefined; e.recall = undefined; e.dmgBy!.clear();
    e.action = undefined; e.dash = undefined; e.path = []; e.inputs!.length = 0; e.input = { mx: 0, my: 0 };
    this.events.push({ e: 'spawn', s: e.id });
  }

  /** Spawn ring around the Heartstone; an existing hero (respawn/recall) keeps its own slot. */
  private spawnPoint(team: Team, id?: number): Vec2 {
    const base = this.map.bases[team].pos;
    const mates = [...this.entities.values()].filter((e) => e.kind === 'hero' && e.team === team).sort((p, q) => p.id - q.id);
    const n = id !== undefined ? Math.max(0, mates.findIndex((e) => e.id === id)) : mates.length;
    // Slots fan out on the gate side of the Heartstone, so every hero (re)spawns facing the valley.
    const toward = Math.atan2(-base.y, -base.x), ang = toward + ((n % 5) - 2) * 0.5;
    return { ...(this.nav.nearestWalkable({ x: base.x + Math.cos(ang) * 5.5, y: base.y + Math.sin(ang) * 5.5 }) ?? base) };
  }

  private inOwnFort(e: Entity): boolean { return dist(e.pos, this.map.bases[e.team].pos) < this.map.bases[e.team].radius; }

  // ---- Damage & status ----------------------------------------------------------------------

  private targetable(t: Entity): boolean { return t.kind !== 'projectile' && t.kind !== 'trap' && !t.deadTicks && t.hp > 0 && !t.invulnerable; }
  private isStructure(t: Entity): boolean { return t.kind === 'tower' || t.kind === 'bulwark' || t.kind === 'heart'; }

  private enemiesInCone(e: Entity, aim: number, range: number, halfAngle: number): Entity[] {
    const out: Entity[] = [];
    for (const t of this.entities.values()) {
      if (t.team === e.team || !this.targetable(t)) continue;
      const d = dist(t.pos, e.pos);
      if (d > range + t.radius) continue;
      const ang = Math.atan2(t.pos.y - e.pos.y, t.pos.x - e.pos.x);
      if (d > t.radius + e.radius && Math.abs(angleDelta(aim, ang)) > halfAngle) continue;
      out.push(t);
    }
    return out;
  }

  /** Damage + CC of an ability on one target. `area` = AoE (half damage to structures, TWIST_BULWARKS §9). */
  private applyAbility(t: Entity, ab: AbilityDef, dmg: number, src: Entity, area = false, skipStun = false): void {
    if (dmg > 0) this.damage(t, dmg * (this.isStructure(t) ? ab.structureMul ?? 1 : 1), src, 1, area);
    if (t.hp <= 0 || t.deadTicks || this.isStructure(t)) return;
    if (ab.stun && !skipStun) this.applyCc(t, 'stun', ab.stun, src);
    if (ab.root) this.applyCc(t, 'root', ab.root, src);
    if (ab.slow) this.applySlow(t, ab.slow.pct, ab.slow.dur);
  }

  private applySlow(t: Entity, pct: number, dur: number): void {
    if (t.slowTicks <= 0 || pct >= t.slowPct) { t.slowTicks = Math.max(t.slowPct === pct ? t.slowTicks : 0, T(dur)); t.slowPct = Math.min(0.6, pct); }
  }

  /** Hard CC with diminishing returns on heroes (HEROES.md §6.4): 100%, then 50%, then immune for 3 s, within 6 s. */
  private applyCc(t: Entity, kind: 'stun' | 'root', secs: number, src?: Entity): void {
    if (t.kind !== 'hero' && t.kind !== 'minion') return;
    if (t.deadTicks || t.hp <= 0) return;
    let mul = 1;
    if (t.kind === 'hero') {
      if (this.tick < (t.drImmune ?? -1)) { this.events.push({ e: 'imm', d: t.id }); return; }
      if (this.tick - (t.drStart ?? -1e9) > T(DR.window)) { t.drStart = this.tick; t.drCount = 0; }
      mul = t.drCount === 0 ? 1 : 0.5;
      t.drCount = (t.drCount ?? 0) + 1;
      if (t.drCount >= 2) t.drImmune = this.tick + T(secs * mul + DR.immune);
    } else if (t.unit === 'troll') mul = 0.5; // bosses shrug off half of it
    const ticks = T(secs * mul);
    if (kind === 'stun') { t.stunTicks = Math.max(t.stunTicks, ticks); t.action = undefined; t.repair = undefined; }
    else t.rootTicks = Math.max(t.rootTicks ?? 0, ticks);
    const l = this.ledger(src); if (l && t.kind === 'hero') l.ccDealt += ticks / TICK_RATE;
  }

  private heal(t: Entity, amount: number, src: Entity | undefined): void {
    if (t.deadTicks || t.hp <= 0 || amount <= 0 || this.isStructure(t)) return; // heals never repair structures
    const n = Math.min(amount, t.maxHp - t.hp);
    t.hp += n;
    if (n >= 1) this.events.push({ e: 'heal', s: src?.id ?? 0, d: t.id, n: Math.round(n) });
    const l = this.ledger(src); if (l && src !== t) l.healing += n;
  }

  private shield(t: Entity, amount: number, ticks: number, src: Entity): void {
    t.shieldHp = Math.max(t.shieldHp ?? 0, amount); t.shieldTicks = Math.max(t.shieldTicks ?? 0, ticks);
    this.events.push({ e: 'shield', s: src.id, d: t.id, n: Math.round(amount) });
    const l = this.ledger(src); if (l) l.shielding += amount;
  }

  /**
   * All damage flows through here: structure rules, items, shields, events, kill credit, telemetry, death handling.
   * kind: 0 basic, 1 ability, 2 structure. `area`: AoE / splash / DoT (half damage to structures).
   */
  private damage(t: Entity, amount: number, src: Entity | undefined, kind: 0 | 1 | 2, area = false): void {
    if (!this.targetable(t)) return;
    if (this.isStructure(t)) {
      if (area) amount *= 0.5;
      if (src?.kind === 'hero') amount *= 1 + (src.ist?.structDmg ?? 0);
    }
    if (t.kind === 'hero') {
      amount *= 1 - (t.ist?.armor ?? 0);
      if (t.shieldHp && t.shieldHp > 0) {
        const absorbed = Math.min(t.shieldHp, amount);
        t.shieldHp -= absorbed; amount -= absorbed;
        if (absorbed > 0 && amount <= 0) { this.events.push({ e: 'hit', s: src?.id ?? 0, d: t.id, n: 0, k: kind }); return; }
      }
    }
    t.hp -= amount;
    t.lastCombat = this.tick;
    t.recall = undefined;
    if (src) {
      t.lastHitBy = src.id; src.lastCombat = this.tick;
      if (t.kind === 'hero' && src.kind === 'hero' && src.team !== t.team) t.dmgBy!.set(src.id, this.tick);
      // Taking a hit from a hero or tower breaks a repair channel; any damage breaks a recall.
      if (t.repair !== undefined && (src.kind === 'hero' || src.kind === 'tower')) t.repair = undefined;
    }
    this.events.push({ e: 'hit', s: src?.id ?? 0, d: t.id, n: Math.round(amount), k: kind });
    // Telemetry
    const credit = src?.kind === 'hero' ? src : src?.kind === 'bulwark' ? this.heroOf(src.bw!.owner) : undefined;
    const l = this.ledger(credit);
    if (l) { if (t.kind === 'hero') l.dmgHeroes += amount; else if (this.isStructure(t)) l.dmgStructs += amount; else l.dmgUnits += amount; }
    const tl = this.ledger(t); if (tl) tl.dmgTaken += amount;
    // Lifesteal on basic attacks against living things.
    if (kind === 0 && src?.kind === 'hero' && (src.ist?.lifesteal ?? 0) > 0 && !this.isStructure(t)) this.heal(src, amount * src.ist!.lifesteal, src);
    if (t.hp <= 0) this.kill(t, src);
  }

  private kill(t: Entity, src: Entity | undefined): void {
    t.hp = 0;
    this.events.push({ e: 'die', s: src?.id ?? 0, d: t.id });
    const killer = src?.kind === 'hero' ? src : src?.kind === 'bulwark' ? this.heroOf(src.bw!.owner) : undefined;
    if (t.kind === 'minion') { const l = this.ledger(killer); if (l) l.lastHits++; if (t.unit === 'troll') this.telemetry.trollKills.push(Math.round((this.tick - this.matchStart) / TICK_RATE)); }
    if (t.kind === 'hero') { t.recall = undefined; this.heroKilled(t, killer?.team !== t.team ? killer : undefined); }
    if (t.kind === 'tower' || t.kind === 'bulwark') {
      if (t.kind === 'tower') { this.telemetry.towersLost[t.team]++; if (t.tier === 2) this.telemetry.firstGateTowerAt ??= Math.round((this.tick - this.matchStart) / TICK_RATE); }
      else this.telemetry.structuresLost[t.team]++;
    }
    this.payBounty(t, src);
    // XP: shared between enemy heroes nearby (+ the killer if it's a hero).
    const xp = t.kind === 'minion' ? (t.unit === 'troll' ? XP.minion * 6 : t.unit === 'brute' ? XP.minion * 3 : XP.minion) : t.kind === 'hero' ? XP.heroBase + XP.heroPerLevel * (t.level ?? 1) : t.kind === 'tower' ? XP.tower : 0;
    if (xp > 0) {
      const takers = [...this.entities.values()].filter((h) => h.kind === 'hero' && h.team !== t.team && !h.deadTicks && (t.kind === 'tower' || dist(h.pos, t.pos) < XP.shareRadius || h.id === src?.id));
      for (const h of takers) this.grantXp(h, t.kind === 'tower' ? xp : xp / Math.max(1, takers.length) * (takers.length > 1 ? 1.3 : 1));
    }
    switch (t.kind) {
      case 'hero':
        t.deadTicks = T(respawnSeconds(t.level ?? 1));
        t.action = undefined; t.dash = undefined; t.moving = false; t.forced = undefined; t.repair = undefined;
        t.hots = []; t.shieldHp = 0; t.rootTicks = 0;
        break;
      case 'heart':
        this.entities.delete(t.id);
        this.endMatch(t.team === 0 ? 1 : 0);
        break;
      case 'tower':
        this.entities.delete(t.id);
        this.updateInvulnerability();
        break;
      case 'bulwark':
        this.removeBulwark(t);
        break;
      default:
        this.entities.delete(t.id);
    }
  }

  /** Kill credit, assists (enemy heroes who hurt the victim in the last 10 s) and the kill feed. */
  private heroKilled(t: Entity, killer: Entity | undefined): void {
    t.deaths = (t.deaths ?? 0) + 1;
    const tl = this.ledger(t); if (tl) tl.deaths++;
    const assists: number[] = [];
    for (const [id, at] of t.dmgBy!) {
      if (id === killer?.id || this.tick - at > T(10)) continue;
      const a = this.entities.get(id); if (!a || a.kind !== 'hero') continue;
      assists.push(id);
      const al = this.ledger(a); if (al) al.assists++;
      this.earn(a, ECON.assistGold);
    }
    if (killer) { killer.kills = (killer.kills ?? 0) + 1; const kl = this.ledger(killer); if (kl) kl.kills++; }
    this.events.push({ e: 'kill', s: killer?.id ?? (t.lastHitBy ?? 0), d: t.id, a: assists });
    t.dmgBy!.clear();
  }

  private endMatch(winner: Team): void {
    this.winner = winner;
    this.overTicks = T(12);
    this.events.push({ e: 'win', t: winner });
    this.sampleHearts();
    for (const h of this.entities.values()) if (h.kind === 'hero') { const l = this.ledger(h); if (l) { l.level = h.level ?? 1; l.items = [...(h.items ?? [])]; } }
    this.lastSummary = this.telemetry.summary(winner, (this.tick - this.matchStart) / TICK_RATE, this.wave);
    this.onMatchEnd?.(this.lastSummary);
  }

  /** Current match report (heroes' levels and items filled in). */
  matchSummary(): MatchSummary {
    for (const h of this.entities.values()) if (h.kind === 'hero') { const l = this.ledger(h); if (l) { l.level = h.level ?? 1; l.items = [...(h.items ?? [])]; } }
    return this.telemetry.summary(this.winner, (this.tick - this.matchStart) / TICK_RATE, this.wave);
  }

  private sampleHearts(): void {
    const hp: [number, number] = [0, 0];
    for (const e of this.entities.values()) if (e.kind === 'heart') hp[e.team] = Math.round(e.hp);
    this.telemetry.heartHpByMinute.push(hp);
  }

  private grantXp(h: Entity, amount: number): void {
    if ((h.level ?? 1) >= MAX_LEVEL) return;
    h.xp = (h.xp ?? 0) + amount;
    while ((h.level ?? 1) < MAX_LEVEL && h.xp >= xpForLevel(h.level ?? 1)) {
      h.xp -= xpForLevel(h.level ?? 1);
      h.level = (h.level ?? 1) + 1;
      this.recalcHero(h);
      this.events.push({ e: 'lvl', s: h.id, l: h.level });
    }
  }

  /** Derive max HP and attack damage from level + items. Gains add to current HP; losses only clamp it. */
  private recalcHero(h: Entity): void {
    const def = HEROES[h.heroId!]!, lvl = (h.level ?? 1) - 1;
    h.ist = itemStats(h.items ?? []);
    const maxHp = Math.round(def.hp + def.hpPerLevel * lvl + h.ist.hp);
    const gain = maxHp - h.maxHp;
    h.maxHp = maxHp;
    if (!h.deadTicks) h.hp = Math.min(maxHp, Math.max(1, h.hp + Math.max(0, gain)));
    h.damage = def.damage + def.damagePerLevel * lvl + h.ist.dmg;
  }

  private tickStatus(e: Entity): void {
    if (e.stunTicks > 0) e.stunTicks--;
    if (e.slowTicks > 0) e.slowTicks--;
    if (e.hasteTicks > 0) e.hasteTicks--;
    if (e.atkTicks > 0) e.atkTicks--;
    if (e.rootTicks) e.rootTicks--;
    if (e.shieldTicks && --e.shieldTicks <= 0) e.shieldHp = 0;
    if (e.hots?.length) {
      for (const h of e.hots) { h.ticks--; this.heal(e, h.per, this.entities.get(h.src)); }
      e.hots = e.hots.filter((h) => h.ticks > 0);
    }
  }

  // ---- Projectiles & ground AoEs ------------------------------------------------------------

  private spawnProjectile(e: Entity, aim: number, speed: number, range: number, dmg: number, width: number, ab: AbilityDef | undefined, fx: string, homing?: number): void {
    const dx = Math.cos(aim), dy = Math.sin(aim);
    this.add({
      kind: 'projectile', team: e.team, pos: { x: e.pos.x + dx * 0.8, y: e.pos.y + dy * 0.8 }, facing: aim, radius: 0.1, speed,
      hp: 1, maxHp: 1, path: [], moving: true, damage: dmg, atkTicks: 0, stunTicks: 0, slowTicks: 0, slowPct: 0, hasteTicks: 0, hastePct: 0,
      proj: { owner: e.id, vx: dx * speed * DT, vy: dy * speed * DT, life: Math.ceil((range / speed) * TICK_RATE), dmg, width, ability: ab, homing, flown: 0 }, fx,
    });
  }

  private stepProjectile(p: Entity): void {
    const pr = p.proj!;
    if (pr.homing !== undefined) { // tower bolts track their target
      const t = this.entities.get(pr.homing);
      if (!t || !this.targetable(t)) { this.entities.delete(p.id); return; }
      const d = dist(t.pos, p.pos), sp = Math.hypot(pr.vx, pr.vy);
      if (d <= sp + t.radius) { this.damage(t, pr.dmg, this.entities.get(pr.owner), 2); this.entities.delete(p.id); return; }
      pr.vx = ((t.pos.x - p.pos.x) / d) * sp; pr.vy = ((t.pos.y - p.pos.y) / d) * sp;
      p.facing = Math.atan2(pr.vy, pr.vx);
      p.pos = { x: p.pos.x + pr.vx, y: p.pos.y + pr.vy };
      return;
    }
    // Swept test along this tick's segment so fast projectiles can't tunnel through targets.
    const a = p.pos, b = { x: a.x + pr.vx, y: a.y + pr.vy };
    const ab = pr.ability;
    const mode = ab?.targets ?? 'enemy';
    const abx = b.x - a.x, aby = b.y - a.y, l2 = abx * abx + aby * aby;
    const hits: { t: Entity; k: number; role: 'enemy' | 'ally' | 'wall' }[] = [];
    for (const t of this.entities.values()) {
      if (t.id === pr.owner || !this.targetable(t)) continue;
      let role: 'enemy' | 'ally' | 'wall' | null = null;
      const enemyWall = t.team !== p.team && t.kind === 'bulwark' && BULWARKS[t.bw!.type].blocks;
      if (t.team === p.team) role = (mode === 'ally' || (mode === 'any' && !pr.doneAlly)) && t.kind === 'hero' ? 'ally' : null;
      else if (mode === 'ally') role = enemyWall ? 'wall' : null;          // ally threads pass through enemies
      else if (mode === 'any' && pr.doneEnemy) role = enemyWall ? 'wall' : null;
      else if (ab?.heroOnly) role = t.kind === 'hero' ? 'enemy' : enemyWall ? 'wall' : null; // hooks ignore minions, palisades stop them
      else role = 'enemy';
      if (!role) continue;
      const k = l2 ? clamp(((t.pos.x - a.x) * abx + (t.pos.y - a.y) * aby) / l2, 0, 1) : 0;
      const d = Math.hypot(t.pos.x - (a.x + abx * k), t.pos.y - (a.y + aby * k));
      if (d <= t.radius + pr.width) hits.push({ t, k, role });
    }
    hits.sort((x, y) => x.k - y.k || x.t.id - y.t.id);
    const src = this.entities.get(pr.owner);
    for (const { t, role } of hits) {
      if (role === 'wall') { this.popProjectile(p, t.pos); return; }
      if (role === 'ally') {
        if (src && ab) this.allyEffect(t, ab, src);
        pr.doneAlly = true;
        if (mode === 'ally' || pr.doneEnemy || !ab?.damage) { this.popProjectile(p, t.pos); return; }
        continue;
      }
      if (ab && src) this.projectileHit(t, ab, pr.dmg, src);
      else this.damage(t, pr.dmg, src, 0);
      pr.doneEnemy = true;
      if (mode !== 'any' || pr.doneAlly) { this.popProjectile(p, t.pos); return; }
    }
    p.pos = b;
    pr.flown += Math.sqrt(l2);
    if (ab?.split && !pr.noSplit && pr.flown >= ab.split.after) { this.splitProjectile(p, ab.split); return; }
    if (--pr.life <= 0 || !this.nav.isWalkable(b) && this.map.obstacles.some((o) => (o.kind === 'rock' || o.kind === 'wall' || o.kind === 'tower') && dist(o, b) < o.r)) this.popProjectile(p, b);
  }

  private popProjectile(p: Entity, at: Vec2): void {
    this.events.push({ e: 'pop', s: p.id, x: round2(at.x), y: round2(at.y), fx: p.fx });
    this.entities.delete(p.id);
  }

  /** Split Shot: the arrow becomes two halves fanning out at ±angle with the remaining flight. */
  private splitProjectile(p: Entity, sp: { angle: number; mul: number }): void {
    const pr = p.proj!, owner = this.entities.get(pr.owner);
    this.entities.delete(p.id);
    if (!owner) return;
    const speed = Math.hypot(pr.vx, pr.vy) / DT, base = Math.atan2(pr.vy, pr.vx);
    for (const s of [-1, 1]) {
      const aim = base + s * sp.angle;
      const c = this.add({ ...p, id: 0, pos: { ...p.pos }, facing: aim, proj: { ...pr, vx: Math.cos(aim) * speed * DT, vy: Math.sin(aim) * speed * DT, dmg: pr.dmg * sp.mul, noSplit: true } } as Omit<Entity, 'id'>);
      c.facing = aim;
    }
  }

  /** Skillshot impact on an enemy: damage/CC, then hook pulls and splash slows. */
  private projectileHit(t: Entity, ab: AbilityDef, dmg: number, src: Entity): void {
    this.applyAbility(t, ab, dmg, src, false, !!ab.pullToCaster);
    if (t.hp <= 0 || t.deadTicks) return;
    if (ab.pull && (t.kind === 'hero' || t.kind === 'minion')) {
      // Never drag past the caster: stop half a metre short of contact.
      const m = Math.min(ab.pull, Math.max(0, dist(t.pos, src.pos) - (t.radius + src.radius + 0.5)));
      this.displace(t, src.pos, -m, 24, ab.pullToCaster ? ab.stun : undefined, src.id);
      this.events.push({ e: 'hook', s: src.id, d: t.id });
    }
    if (ab.splashSlow) {
      const sl = ab.splashSlow;
      for (const o of this.entities.values()) {
        if (o.team === src.team || o === t || !this.targetable(o) || (o.kind !== 'hero' && o.kind !== 'minion')) continue;
        if (dist(o.pos, t.pos) <= sl.r + o.radius) this.applySlow(o, sl.pct, sl.dur);
      }
    }
  }

  /** Ally-attach effects (Halla): heal and/or shield the first ally hero touched. */
  private allyEffect(t: Entity, ab: AbilityDef, src: Entity): void {
    const lvl = (src.level ?? 1) - 1, power = 1 + (src.ist?.power ?? 0);
    if (ab.heal) this.heal(t, (ab.heal + (ab.healPerLevel ?? 0) * lvl) * power, src);
    if (ab.shield) this.shield(t, (ab.shield.flat + ab.shield.perLevel * lvl + ab.shield.pct * t.maxHp) * power, T(ab.shield.dur), src);
  }

  private stepTrap(e: Entity): void {
    const tr = e.trap!;
    if (tr.arm > 0) tr.arm--;
    if (--tr.life <= 0) { this.entities.delete(e.id); this.events.push({ e: 'die', s: 0, d: e.id }); return; }
    if (tr.arm > 0) return;
    for (const t of this.entities.values()) {
      if (t.kind !== 'hero' || t.team === e.team || !this.targetable(t)) continue;
      if (dist(t.pos, e.pos) > e.radius + t.radius * 0.5) continue;
      const src = this.entities.get(tr.owner);
      this.events.push({ e: 'snare', s: e.id, d: t.id });
      if (src) this.applyAbility(t, tr.ability, tr.dmg, src); else this.applyCc(t, 'root', tr.ability.root ?? 0.8);
      this.entities.delete(e.id);
      return;
    }
  }

  private stepAoes(): void {
    for (const a of [...this.aoes]) {
      if (--a.ticks > 0) continue;
      const pulses = a.ability?.pulses;
      if (pulses && a.pulsesLeft! > 1) { a.pulsesLeft!--; a.ticks = T(pulses.every); }
      else this.aoes.splice(this.aoes.indexOf(a), 1);
      const src = this.entities.get(a.owner);
      const r = a.ability?.radius ?? a.r ?? 3;
      for (const t of [...this.entities.values()]) {
        if (t.team === a.team || !this.targetable(t) || t.kind === 'heart') continue;
        if (dist(t.pos, a) > r + t.radius) continue;
        if (a.ability && src) this.applyAbility(t, a.ability, a.dmg, src, true);
        else if (!a.ability && (t.kind === 'minion' || t.kind === 'hero')) this.damage(t, a.dmg, src, 2, true);
      }
      if (a.burn) this.burns.push({ owner: a.owner, team: a.team, x: a.x, y: a.y, r: a.burn.r, dps: a.burn.dps, ticks: T(a.burn.dur) });
      this.events.push({ e: 'aoe', s: a.owner, x: round2(a.x), y: round2(a.y), r, fx: a.ability?.id ?? 'ember' });
    }
  }

  // ---- Structures ---------------------------------------------------------------------------

  private spawnStructures(): void {
    for (const t of this.map.towers) {
      this.add({ kind: 'tower', team: t.team, pos: { x: t.x, y: t.y }, facing: 0, radius: 1.5, speed: 0, hp: TOWER.hp, maxHp: TOWER.hp, path: [], moving: false,
        damage: TOWER.damageVsHero, atkTicks: 0, stunTicks: 0, slowTicks: 0, slowPct: 0, hasteTicks: 0, hastePct: 0, tier: t.tier, lane: t.lane });
    }
    for (const team of [0, 1] as const) {
      const b = this.map.bases[team].pos;
      this.add({ kind: 'heart', team, pos: { ...b }, facing: 0, radius: 1.8, speed: 0, hp: HEART.hp, maxHp: HEART.hp, path: [], moving: false,
        damage: 0, atkTicks: 0, stunTicks: 0, slowTicks: 0, slowPct: 0, hasteTicks: 0, hastePct: 0 });
    }
    this.updateInvulnerability();
  }

  /** Inner towers are protected until their lane's outer tower falls; the Heartstone (vs. heroes) until a gate tower falls. */
  private updateInvulnerability(): void {
    const towers = [...this.entities.values()].filter((e) => e.kind === 'tower');
    for (const t of towers) if (t.tier === 2) t.invulnerable = towers.some((o) => o.team === t.team && o.lane === t.lane && o.tier === 1);
    for (const h of this.entities.values()) if (h.kind === 'heart') h.invulnerable = towers.filter((o) => o.team === h.team && o.tier === 2).length === 3;
  }

  private stepTower(e: Entity): void {
    if (e.atkTicks > 0) return;
    let tgt = e.target !== undefined ? this.entities.get(e.target) : undefined;
    if (!tgt || !this.targetable(tgt) || dist(tgt.pos, e.pos) > TOWER.range + tgt.radius) {
      // Priority: minions first, then heroes (closest within each class).
      let best: Entity | undefined, bestScore = Infinity;
      for (const c of this.entities.values()) {
        if (c.team === e.team || !this.targetable(c) || (c.kind !== 'minion' && c.kind !== 'hero')) continue;
        const d = dist(c.pos, e.pos);
        if (d > TOWER.range + c.radius) continue;
        const score = d + (c.kind === 'hero' ? 1000 : 0);
        if (score < bestScore) { bestScore = score; best = c; }
      }
      tgt = best; e.target = best?.id;
    }
    if (!tgt) return;
    e.atkTicks = T(TOWER.cooldown);
    const aim = Math.atan2(tgt.pos.y - e.pos.y, tgt.pos.x - e.pos.x);
    const dmg = tgt.kind === 'hero' ? TOWER.damageVsHero : TOWER.damageVsMinion;
    this.spawnProjectile(e, aim, TOWER.boltSpeed, 40, dmg, 0.3, undefined, 'tower_bolt', tgt.id);
    this.events.push({ e: 'act', s: e.id, a: 0, y: round2(aim) });
  }

  // ---- Minions ------------------------------------------------------------------------------

  private ticksToNextWave(): number {
    const every = Math.round(WAVES.interval * TICK_RATE), first = Math.round(WAVES.first * TICK_RATE);
    const t = this.tick - this.matchStart;
    if (t < first) return first - t;
    return every - ((t - first) % every);
  }

  private spawnWaves(): void {
    const every = Math.round(WAVES.interval * TICK_RATE), first = Math.round(WAVES.first * TICK_RATE);
    const t = this.tick - this.matchStart;
    if (t < first || (t - first) % every !== 0) return;
    this.wave++;
    for (const h of this.entities.values()) if (h.kind === 'hero') this.earn(h, h.income!);
    this.events.push({ e: 'wave', n: this.wave });
    const hpMul = 1 + WAVES.hpGrowth * (this.wave - 1), dmgMul = 1 + WAVES.dmgGrowth * (this.wave - 1);
    for (const team of [0, 1] as const) for (const lane of ['top', 'mid', 'bot'] as const) {
      const units: UnitType[] = Array(WAVES.perLane).fill('minion');
      if (this.wave >= WAVES.bossFirst && this.wave % WAVES.bossEvery === 0) units.push('troll');
      const t = (this.tick - this.matchStart) / TICK_RATE;
      if (t >= WAVES.stallFrom) for (let k = 0; k < 1 + 2 * Math.floor((t - WAVES.stallFrom) / WAVES.stallStep); k++) units.push('troll');
      units.push(...this.sendQueue[team][lane]);
      this.sendQueue[team][lane] = [];
      const pts = this.lanePoints(lane, team);
      const start = pts[0]!, dir = { x: Math.sign(pts[1]!.x - start.x), y: Math.sign(pts[1]!.y - start.y) };
      units.forEach((u, i) => {
        const def = UNITS[u];
        const back = { x: start.x - dir.x * (i % 6) * 1.3 + (i >= 6 ? 1.2 : 0), y: start.y - dir.y * (i % 6) * 1.3 };
        const scale = u === 'minion' || u === 'troll' ? hpMul : 1 + (hpMul - 1) * 0.5;
        this.add({ kind: 'minion', unit: u, team, pos: this.nav.nearestWalkable(back) ?? { ...start }, facing: Math.atan2(dir.y, dir.x), radius: def.radius, speed: def.speed,
          hp: Math.round(def.hp * scale), maxHp: Math.round(def.hp * scale), path: [], moving: true, damage: def.damage * dmgMul, atkTicks: 0, stunTicks: 0,
          slowTicks: 0, slowPct: 0, hasteTicks: 0, hastePct: 0, lane, laneIdx: 1 });
      });
    }
  }

  lanePoints(lane: LaneId, team: Team): Vec2[] {
    const pts = this.map.lanes[lane];
    return team === 0 ? pts : [...pts].reverse();
  }

  // ---- Tower-defence pathing ----------------------------------------------------------------

  private prepareFlow(): void {
    const n = this.nav.size;
    const mask = (lane: LaneId) => {
      const m = new Uint8Array(n * n);
      for (let i = 0; i < n * n; i++) {
        const p = this.nav.toWorld(i % n, (i / n) | 0);
        const inFort = [0, 1].some((t) => dist(p, this.map.bases[t as Team].pos) < FORT_WALL_R + 3);
        m[i] = inFort || distToPolyline(p, this.map.lanes[lane]) < this.map.laneHalfWidth + 2.5 ? 1 : OFF_LANE_COST; // step cost
      }
      return m;
    };
    this.laneMask = { top: mask('top'), mid: mask('mid'), bot: mask('bot') };
    for (const t of [0, 1] as const) {
      const hp = this.map.bases[t].pos, goals: number[] = [];
      for (let i = 0; i < n * n; i++) { const p = this.nav.toWorld(i % n, (i / n) | 0); if (dist(p, hp) < 4.6 && this.nav.isWalkableCell(i % n, (i / n) | 0)) goals.push(i); }
      this.heartGoals[t] = goals;
    }
    this.flowDirty = true;
  }

  /** Recompute all 6 lane flow fields (attacker team x lane): start of match / reset only. */
  private rebuildFlow(): void {
    this.flowDirty = false; this.dirtyFields.clear();
    for (const attacker of [0, 1] as const) for (const lane of ['top', 'mid', 'bot'] as const) this.rebuildField(`${attacker}:${lane}`);
  }

  private rebuildField(key: string): void {
    const [a, lane] = key.split(':') as [string, LaneId];
    const attacker = Number(a) as Team;
    this.flow[key] = this.nav.flowField(this.heartGoals[attacker === 0 ? 1 : 0], this.laneMask![lane]);
  }

  /** A team's structures only change the paths of the *other* team's waves. */
  private mazeChanged(defender: Team): void {
    const attacker = defender === 0 ? 1 : 0;
    for (const lane of ['top', 'mid', 'bot'] as const) this.dirtyFields.add(`${attacker}:${lane}`);
  }

  /** Steer a wave unit down its lane's flow field (around player mazes) toward the enemy Heartstone. */
  private flowStep(e: Entity): void {
    const field = this.flow[`${e.team}:${e.lane}`];
    const n = this.nav.size;
    let [cx, cy] = this.nav.toCell(e.pos);
    let target: Vec2 | null = null;
    if (field && Number.isFinite(field[cy * n + cx]!)) {
      // Follow the steepest descent a few cells ahead and aim at that cell centre (smooth, maze-aware).
      for (let k = 0; k < 3; k++) {
        let best = field[cy * n + cx]!, bx = cx, by = cy;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if ((!dx && !dy) || !this.nav.inBounds(nx, ny)) continue;
          if (dx && dy && (!this.nav.isWalkableCell(cx + dx, cy) || !this.nav.isWalkableCell(cx, cy + dy))) continue;
          const v = field[ny * n + nx]!;
          if (v < best) { best = v; bx = nx; by = ny; }
        }
        if (bx === cx && by === cy) break;
        cx = bx; cy = by;
        if (k === 0 || this.nav.lineOfSight(e.pos, this.nav.toWorld(cx, cy))) target = this.nav.toWorld(cx, cy); else break;
      }
    }
    target ??= this.map.bases[e.team === 0 ? 1 : 0].pos;
    const d = dist(target, e.pos);
    if (d < 1e-3) return;
    e.facing = Math.atan2(target.y - e.pos.y, target.x - e.pos.x);
    const sp = Math.min(d, e.speed * this.speedMul(e) * DT);
    const next = moveWithCollision(this.nav, e.pos, Math.cos(e.facing) * sp, Math.sin(e.facing) * sp);
    e.moving = next.x !== e.pos.x || next.y !== e.pos.y;
    e.pos = next;
  }

  private stepMinion(e: Entity): void {
    if (e.stunTicks > 0) { e.moving = false; return; }
    const def = UNITS[e.unit ?? 'minion'];
    // Leak: reaching the enemy Heartstone damages it (ignores hero-damage protection) and spends the unit.
    const enemyHeart = [...this.entities.values()].find((h) => h.kind === 'heart' && h.team !== e.team);
    if (enemyHeart && dist(enemyHeart.pos, e.pos) <= enemyHeart.radius + e.radius + 1.6) {
      this.events.push({ e: 'leak', t: enemyHeart.team, n: def.leak, s: e.id });
      this.telemetry.leaks.push({ team: enemyHeart.team, lane: e.lane ?? '?', unit: e.unit ?? 'minion', hp: def.leak });
      this.entities.delete(e.id);
      enemyHeart.hp -= def.leak;
      this.events.push({ e: 'hit', s: e.id, d: enemyHeart.id, n: def.leak, k: 0 });
      if (enemyHeart.hp <= 0) this.kill(enemyHeart, undefined);
      return;
    }
    if (e.forced) { this.stepForced(e); return; }
    if (e.action) { // wind-up of a swing
      if (--e.action.ticks <= 0) {
        const t = this.entities.get(e.target ?? -1);
        if (t && this.targetable(t) && dist(t.pos, e.pos) <= def.range + t.radius + e.radius + 0.4) this.damage(t, e.damage, e, 0);
        e.action = undefined;
      }
      return;
    }
    let t = e.target !== undefined ? this.entities.get(e.target) : undefined;
    const structRange = (c: Entity) => c.kind === 'tower' || c.kind === 'bulwark';
    if (!t || !this.targetable(t) || dist(t.pos, e.pos) > MINION.leash || (structRange(t) && dist(t.pos, e.pos) > 4 + t.radius)) {
      t = undefined; let bestD = MINION.aggro;
      for (const c of this.entities.values()) {
        if (c.team === e.team || !this.targetable(c) || c.kind === 'projectile' || c.kind === 'heart') continue;
        const raw = dist(c.pos, e.pos) - c.radius;
        if (structRange(c) && raw > 4) continue; // walk past structures unless they're right there
        const d = raw + (c.kind === 'hero' ? 2 : 0) + (structRange(c) ? 1 : 0);
        if (d < bestD) { bestD = d; t = c; }
      }
      e.target = t?.id;
    }
    if (t) {
      const d = dist(t.pos, e.pos);
      e.facing = Math.atan2(t.pos.y - e.pos.y, t.pos.x - e.pos.x);
      if (d <= def.range + t.radius + e.radius) {
        e.moving = false;
        if (e.atkTicks <= 0) { e.atkTicks = T(def.cooldown); e.action = { slot: 0, ticks: T(MINION.windup), aim: e.facing, tx: 0, ty: 0 }; this.events.push({ e: 'act', s: e.id, a: 0, y: round2(e.facing) }); }
        return;
      }
      const sp = e.speed * this.speedMul(e) * DT;
      const next = moveWithCollision(this.nav, e.pos, Math.cos(e.facing) * sp, Math.sin(e.facing) * sp);
      if (next.x === e.pos.x && next.y === e.pos.y) { this.flowStep(e); return; } // blocked by a wall: route via the maze
      e.pos = next; e.moving = true;
      return;
    }
    this.flowStep(e);
  }

  // ---- Bulwarks: build / upgrade / sell / send ----------------------------------------------

  /** Static placement rules shared with the client's ghost preview. Returns a reason string or null. */
  static siteProblem(w: { map: World['map']; nav: World['nav'] }, team: Team, x: number, y: number): string | null {
    if (x % 2 !== 0 || y % 2 !== 0) return 'off grid';
    const own = w.map.bases[team].pos, enemy = w.map.bases[team === 0 ? 1 : 0].pos;
    if (dist({ x, y }, own) + ECON.territoryMargin > dist({ x, y }, enemy)) return 'outside your territory';
    for (const t of [0, 1] as const) if (dist({ x, y }, w.map.bases[t].pos) < FORT_WALL_R + 2.5) return 'too close to a fort';
    for (const c of w.nav.footprint(x, y)) if (!w.nav.walk[c] || w.nav.blocked[c]) return 'blocked ground';
    if (w.nav.footprint(x, y).length !== 4) return 'blocked ground';
    return null;
  }

  private tryBuild(h: Entity, kind: string, x: number, y: number): string | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 'bad position';
    const def = BULWARKS[kind as BulwarkType];
    if (!def) return 'unknown structure';
    if (h.deadTicks) return 'dead';
    x = Math.round(x / 2) * 2; y = Math.round(y / 2) * 2;
    if (h.gold! < def.levels[0].cost) return 'not enough gold';
    if (dist(h.pos, { x, y }) > ECON.buildRange) return 'too far';
    const site = World.siteProblem(this, h.team, x, y);
    if (site) return site;
    let count = 0, own = 0;
    for (const e of this.entities.values()) {
      if (e.kind === 'bulwark' && e.team === h.team) { count++; if (e.bw!.owner === h.owner) own++; }
      if ((e.kind === 'hero' && !e.deadTicks) || e.kind === 'minion') if (Math.abs(e.pos.x - x) < 1 + e.radius && Math.abs(e.pos.y - y) < 1 + e.radius) return 'units in the way';
      if (e.kind === 'bulwark' && e.pos.x === x && e.pos.y === y) return 'occupied';
    }
    if (own >= ECON.capPerHero) return `structure limit reached (${ECON.capPerHero} each) — sell or upgrade`;
    if (count >= ECON.maxPerTeam) return 'team structure limit reached';
    const cells = this.nav.footprint(x, y);
    if (def.blocks) {
      this.nav.block(cells, true);
      const goals = new Set(this.heartGoals[h.team]);
      const enemyTeam = h.team === 0 ? 1 : 0;
      const open = (['top', 'mid', 'bot'] as const).every((lane) => this.nav.reachable(this.lanePoints(lane, enemyTeam)[0]!, goals));
      if (!open) { this.nav.block(cells, false); return 'would seal the lane — leave a path'; }
      this.mazeChanged(h.team);
    }
    h.gold! -= def.levels[0].cost;
    const led = this.ledger(h);
    if (led) { this.telemetry.spend(led, 'build', def.levels[0].cost); led.built[def.type] = (led.built[def.type] ?? 0) + 1; }
    const lvl = def.levels[0];
    const b = this.add({ kind: 'bulwark', team: h.team, pos: { x, y }, facing: h.team === 0 ? Math.PI / 4 : -3 * Math.PI / 4, radius: 1, speed: 0, hp: lvl.hp, maxHp: lvl.hp,
      path: [], moving: false, damage: lvl.damage ?? 0, atkTicks: 0, stunTicks: 0, slowTicks: 0, slowPct: 0, hasteTicks: 0, hastePct: 0,
      invulnerable: def.type === 'spikes', bw: { type: def.type, level: 1, owner: h.owner!, cells: def.blocks ? cells : [], charges: lvl.charges ?? 0 } });
    this.events.push({ e: 'build', s: b.id, b: BULWARK_TYPES.indexOf(def.type), x, y });
    return null;
  }

  /** True when `owner` can still place a structure (own allowance and team ceiling). */
  canBuildMore(owner: string, team: Team): boolean {
    let count = 0, own = 0;
    for (const e of this.entities.values()) if (e.kind === 'bulwark' && e.team === team) { count++; if (e.bw!.owner === owner) own++; }
    return own < ECON.capPerHero && count < ECON.maxPerTeam;
  }

  private ownStructure(h: Entity, id: number): Entity | string {
    const b = this.entities.get(id);
    if (!b || b.kind !== 'bulwark' || b.team !== h.team) return 'not your structure';
    if (h.deadTicks) return 'dead';
    if (dist(b.pos, h.pos) > ECON.interactRange + 2) return 'too far';
    return b;
  }

  private tryUpgrade(h: Entity, id: number): string | null {
    const b = this.ownStructure(h, id);
    if (typeof b === 'string') return b;
    const def = BULWARKS[b.bw!.type];
    if (b.bw!.level >= 3) return 'already at max level';
    const next = def.levels[b.bw!.level]!;
    if (h.gold! < next.cost) return 'not enough gold';
    h.gold! -= next.cost;
    this.telemetry.spend(this.ledger(h), 'upgrade', next.cost);
    const frac = b.hp / b.maxHp;
    b.bw!.level++; b.maxHp = next.hp; b.hp = Math.max(1, Math.round(next.hp * frac)); b.damage = next.damage ?? 0;
    if (next.charges) b.bw!.charges = next.charges;
    this.events.push({ e: 'build', s: b.id, b: BULWARK_TYPES.indexOf(b.bw!.type), x: b.pos.x, y: b.pos.y, lv: b.bw!.level });
    return null;
  }

  private trySell(h: Entity, id: number): string | null {
    const b = this.ownStructure(h, id);
    if (typeof b === 'string') return b;
    const refund = Math.floor(investedIn(b.bw!.type, b.bw!.level) * ECON.sellRefund * (b.bw!.type === 'spikes' ? 1 : b.hp / b.maxHp));
    h.gold! += refund; this.telemetry.sells.count++; this.telemetry.sells.gold += refund;
    this.events.push({ e: 'die', s: h.id, d: b.id });
    this.removeBulwark(b);
    return null;
  }

  private removeBulwark(b: Entity): void {
    if (b.bw!.cells.length) { this.nav.block(b.bw!.cells, false); this.mazeChanged(b.team); }
    this.entities.delete(b.id);
  }

  private trySend(h: Entity, unit: string, lane: string): string | null {
    const s = SENDS[unit as SendType];
    if (!s || !['top', 'mid', 'bot'].includes(lane)) return 'invalid send';
    if (h.gold! < s.cost) return 'not enough gold';
    const q = this.sendQueue[h.team][lane as LaneId];
    if (q.length >= 12) return 'lane is full this wave';
    h.gold! -= s.cost; h.income! = Math.min(h.income! + s.income, ECON.baseIncome + ECON.sendIncomeCap);
    this.telemetry.spend(this.ledger(h), 'send', s.cost);
    for (let i = 0; i < s.count; i++) q.push(s.unit);
    this.events.push({ e: 'send', s: h.id, u: unit, l: lane });
    return null;
  }

  // ---- Repair & items --------------------------------------------------------------------------

  private tryRepair(h: Entity, id: number): string | null {
    if (id === 0) { h.repair = undefined; return null; }
    if (h.deadTicks) return 'dead';
    const b = this.entities.get(id);
    if (!b || b.kind !== 'bulwark' || b.team !== h.team) return 'only friendly bulwarks can be repaired';
    if (b.bw!.type === 'spikes') return 'caltrops cannot be repaired';
    if (dist(b.pos, h.pos) > REPAIR.range + b.radius + 0.5) return 'too far — stand next to it';
    if (b.hp >= b.maxHp) return 'already at full strength';
    if (h.gold! < 1) return 'not enough gold';
    h.repair = id; h.path = []; h.action = undefined;
    return null;
  }

  /** Repair channel: restores HP every tick for gold; a full repair costs REPAIR.costFrac of the gold invested. */
  private stepRepair(e: Entity): void {
    const b = this.entities.get(e.repair!);
    if (!b || b.kind !== 'bulwark' || b.team !== e.team || dist(b.pos, e.pos) > REPAIR.range + b.radius + 0.5 || e.action || b.hp >= b.maxHp) { e.repair = undefined; return; }
    const bonus = e.ist?.repair ?? 0;
    const amt = Math.min(b.maxHp * REPAIR.ratePerSec * (1 + bonus) * DT, b.maxHp - b.hp);
    const cost = investedIn(b.bw!.type, b.bw!.level) * REPAIR.costFrac * (amt / b.maxHp) * (1 - bonus * 0.66);
    if (e.gold! < cost) { e.repair = undefined; this.deny(e, 'not enough gold to keep repairing'); return; }
    e.gold! -= cost; b.hp += amt;
    this.telemetry.spend(this.ledger(e), 'repair', cost);
    e.facing = Math.atan2(b.pos.y - e.pos.y, b.pos.x - e.pos.x);
  }

  private canShop(h: Entity): boolean { return !!h.deadTicks || this.inOwnFort(h); }

  private tryBuy(h: Entity, item: string): string | null {
    const def = ITEMS[item as ItemId];
    if (!def) return 'unknown item';
    if (!this.canShop(h)) return 'shop at your fort';
    if (h.items!.includes(item)) return 'already owned';
    if (h.items!.length >= MAX_ITEMS) return 'no free item slot — sell one first';
    if (h.gold! < def.cost) return 'not enough gold';
    h.gold! -= def.cost;
    h.items!.push(item);
    this.recalcHero(h);
    this.telemetry.spend(this.ledger(h), 'item', def.cost);
    this.events.push({ e: 'buy', s: h.id, i: item });
    return null;
  }

  private trySellItem(h: Entity, slot: number): string | null {
    const item = h.items![slot];
    if (!item) return 'empty slot';
    if (!this.canShop(h)) return 'shop at your fort';
    h.items!.splice(slot, 1);
    h.gold! += Math.floor(ITEMS[item as ItemId].cost * ITEM_SELL_REFUND);
    this.recalcHero(h);
    this.events.push({ e: 'buy', s: h.id, i: item, sold: 1 });
    return null;
  }

  private stepBulwark(b: Entity): void {
    const lvl = BULWARKS[b.bw!.type].levels[b.bw!.level - 1]!;
    switch (b.bw!.type) {
      case 'frost':
        for (const t of this.entities.values()) {
          if (t.team === b.team || !this.targetable(t) || (t.kind !== 'minion' && t.kind !== 'hero')) continue;
          if (dist(t.pos, b.pos) > (lvl.aura ?? 6) + t.radius) continue;
          if (t.slowTicks <= 2 || (lvl.slow ?? 0) >= t.slowPct) { t.slowTicks = Math.max(t.slowTicks, 3); t.slowPct = Math.max(lvl.slow ?? 0, t.slowTicks > 3 ? t.slowPct : 0); }
          if (lvl.chillDps && this.tick % 10 === 0) this.damage(t, lvl.chillDps / 3, b, 2);
        }
        return;
      case 'spikes': {
        if (this.tick % 6 !== 0) return; // 5 Hz damage pulses
        for (const t of this.entities.values()) {
          if (t.team === b.team || !this.targetable(t) || (t.kind !== 'minion' && t.kind !== 'hero')) continue;
          if (Math.abs(t.pos.x - b.pos.x) > 1.1 + t.radius * 0.5 || Math.abs(t.pos.y - b.pos.y) > 1.1 + t.radius * 0.5) continue;
          this.damage(t, (lvl.trapDps ?? 20) / 5, b, 2);
          if (--b.bw!.charges <= 0) { this.events.push({ e: 'die', s: 0, d: b.id }); this.removeBulwark(b); return; }
        }
        return;
      }
      case 'palisade': return;
      case 'arrow': case 'fire': {
        if (b.atkTicks > 0) return;
        let best: Entity | undefined, bestScore = Infinity;
        for (const c of this.entities.values()) {
          if (c.team === b.team || !this.targetable(c) || (c.kind !== 'minion' && c.kind !== 'hero')) continue;
          const d = dist(c.pos, b.pos);
          if (d > (lvl.range ?? 10) + c.radius || d < (lvl.minRange ?? 0)) continue;
          const score = d + (c.kind === 'hero' ? 6 : 0); // TD convention: waves first
          if (score < bestScore) { bestScore = score; best = c; }
        }
        if (!best) return;
        b.atkTicks = T(lvl.cooldown ?? 1);
        const aim = Math.atan2(best.pos.y - b.pos.y, best.pos.x - b.pos.x);
        b.facing = aim;
        this.events.push({ e: 'act', s: b.id, a: 0, y: round2(aim) });
        if (b.bw!.type === 'arrow') this.spawnProjectile(b, aim, 40, (lvl.range ?? 12) + 4, lvl.damage ?? 30, 0.3, undefined, 'arrow', best.id);
        else {
          // Lobbed fire: lands where the target is now after a flight time (dodgeable), splashes.
          const d = dist(best.pos, b.pos);
          this.aoes.push({ owner: b.id, team: b.team, x: best.pos.x, y: best.pos.y, ticks: T(0.35 + d / 18), dmg: lvl.damage ?? 50, r: lvl.splash ?? 2.5, burn: lvl.burn });
          this.events.push({ e: 'lob', s: b.id, x: round2(best.pos.x), y: round2(best.pos.y), d: round2(0.35 + d / 18) });
        }
        return;
      }
    }
  }

  private stepBurns(): void {
    for (const bn of [...this.burns]) {
      if (--bn.ticks <= 0) { this.burns.splice(this.burns.indexOf(bn), 1); continue; }
      if (this.tick % 10 !== 0) continue;
      const src = this.entities.get(bn.owner);
      for (const t of this.entities.values()) {
        if (t.team === bn.team || !this.targetable(t) || (t.kind !== 'minion' && t.kind !== 'hero')) continue;
        if (dist(t.pos, bn) <= bn.r + t.radius) this.damage(t, bn.dps / 3, src, 2, true);
      }
    }
  }

  /** Gold: last-hitting hero (or the owner of the structure that killed it) gets the bounty; otherwise nearby heroes share. */
  private payBounty(t: Entity, src: Entity | undefined): void {
    let bounty = 0;
    if (t.kind === 'minion') bounty = UNITS[t.unit ?? 'minion'].bounty;
    else if (t.kind === 'hero') bounty = ECON.heroBounty;
    else if (t.kind === 'bulwark') bounty = Math.round(investedIn(t.bw!.type, t.bw!.level) * ECON.bulwarkBountyFrac);
    else if (t.kind === 'tower') { for (const h of this.entities.values()) if (h.kind === 'hero' && h.team !== t.team) this.earn(h, ECON.gateTowerTeam); return; }
    if (!bounty) return;
    const credit = src?.kind === 'hero' ? src : src?.kind === 'bulwark' ? this.heroOf(src.bw!.owner) : undefined;
    if (credit && credit.team !== t.team) { this.earn(credit, bounty); this.events.push({ e: 'gold', s: credit.id, n: bounty, d: t.id }); return; }
    const near = [...this.entities.values()].filter((h) => h.kind === 'hero' && h.team !== t.team && !h.deadTicks && dist(h.pos, t.pos) < ECON.shareRadius);
    for (const h of near) this.earn(h, (bounty * ECON.bountyShare) / near.length);
  }

  private integrate(e: Entity): void {
    let budget = e.speed * this.speedMul(e) * DT;
    while (budget > 0 && e.path.length) {
      const wp = e.path[0]!;
      const d = dist(e.pos, wp);
      if (d < 1e-4) { e.path.shift(); continue; }
      e.facing = Math.atan2(wp.y - e.pos.y, wp.x - e.pos.x);
      const k = Math.min(1, budget / d);
      const next = moveWithCollision(this.nav, e.pos, (wp.x - e.pos.x) * k, (wp.y - e.pos.y) * k);
      if (next.x === e.pos.x && next.y === e.pos.y) { e.path.shift(); break; } // blocked: drop the waypoint
      budget -= dist(e.pos, next); e.pos = next;
      if (k >= 1) e.path.shift(); else budget = 0;
    }
    e.moving = e.path.length > 0;
  }

  /** Soft unit separation for mobile units; resolved positions stay on walkable ground. */
  private separate(): void {
    const list = [...this.entities.values()].filter((e) => (e.kind === 'hero' || e.kind === 'minion') && !e.deadTicks);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!, b = list[j]!;
      const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
      const min = a.radius + b.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 < 1e-8) continue;
      const d = Math.sqrt(d2), push = (min - d) * 0.5;
      const nx = dx / d, ny = dy / d;
      // Heroes are pushed less by minions so player movement (and prediction) stays crisp.
      const wa = a.kind === 'hero' && b.kind === 'minion' ? 0.2 : 1, wb = b.kind === 'hero' && a.kind === 'minion' ? 0.2 : 1;
      const na = { x: a.pos.x - nx * push * wa, y: a.pos.y - ny * push * wa };
      const nb = { x: b.pos.x + nx * push * wb, y: b.pos.y + ny * push * wb };
      if (this.nav.isWalkable(na)) a.pos = na;
      if (this.nav.isWalkable(nb)) b.pos = nb;
    }
  }

  // ---- Match lifecycle ----------------------------------------------------------------------

  /** Clear the battlefield and restart with the same players (heroes keep their pick, reset to level 1). */
  resetMatch(): void {
    const heroes = [...this.entities.values()].filter((e) => e.kind === 'hero');
    this.entities.clear(); this.aoes = []; this.burns = []; this.winner = null; this.wave = 0;
    this.nav.blocked.fill(0); this.flowDirty = true;
    this.sendQueue = { 0: { top: [], mid: [], bot: [] }, 1: { top: [], mid: [], bot: [] } };
    this.matchStart = this.tick + 1;
    this.telemetry = new Telemetry();
    this.spawnStructures();
    for (const h of heroes) {
      const n = this.spawnHero(h.owner!, h.team, h.heroId, h.bot);
      n.lastSeq = h.lastSeq; // keep the client's input sequence valid
    }
    this.events.push({ e: 'reset' });
  }

  private add(e: Omit<Entity, 'id'>): Entity {
    const ent: Entity = { ...e, id: this.nextId++ };
    this.entities.set(ent.id, ent);
    return ent;
  }
}

const KIND_CODE: Record<EntityKind, EntitySnapshot['k']> = { hero: 0, minion: 1, tower: 2, projectile: 3, heart: 4, bulwark: 5, trap: 6 };
const round2 = (v: number) => Math.round(v * 100) / 100;
export type { HeroDef };
