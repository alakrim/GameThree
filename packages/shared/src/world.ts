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

export type EntityKind = 'hero' | 'minion' | 'tower' | 'heart' | 'projectile' | 'bulwark';

/** An in-progress attack or ability (windup -> resolve). */
interface Action { slot: number; ticks: number; aim: number; tx: number; ty: number }
interface Dash { dx: number; dy: number; ticks: number; ability: AbilityDef; hit: boolean }
interface Projectile { owner: number; vx: number; vy: number; life: number; dmg: number; width: number; ability?: AbilityDef; homing?: number }
interface PendingAoe { owner: number; team: Team; x: number; y: number; ticks: number; ability?: AbilityDef; dmg: number; r?: number; burn?: { dps: number; dur: number; r: number } }
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
    });
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
        const heroId = n % 2 === 0 ? 'sigrun' : 'hrodvar';
        this.spawnHero(id, team, heroId, true);
        this.bots.set(id, new BotBrain(id, lanes[n % lanes.length]!));
      }
    }
  }

  queue(playerId: string, cmd: Command): void { this.pending.push({ playerId, cmd }); }

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
    if (this.tick % TICK_RATE === 0) for (const e of this.entities.values()) if (e.kind === 'hero') e.gold! += ECON.passivePerSec;
    for (const e of [...this.entities.values()]) {
      if (!this.entities.has(e.id)) continue;
      this.tickStatus(e);
      switch (e.kind) {
        case 'hero': this.stepHero(e); break;
        case 'minion': this.stepMinion(e); break;
        case 'tower': this.stepTower(e); break;
        case 'projectile': this.stepProjectile(e); break;
        case 'bulwark': this.stepBulwark(e); break;
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
      if (e.invulnerable) st |= 16;
      if (e.dash) st |= 32;
      if (st) s.st = st;
      if (e.kind === 'hero') {
        s.o = e.owner; s.h = e.heroId; s.sq = e.lastSeq; s.lv = e.level;
        s.xp = round2((e.xp ?? 0) / xpForLevel(e.level ?? 1));
        s.cd = e.cds!.map((c) => Math.ceil(c / 3)); // tenths of a second
        s.sm = round2(this.speedMul(e));
        if (e.deadTicks) s.rs = Math.ceil(e.deadTicks / TICK_RATE);
        s.g = Math.floor(e.gold ?? 0); s.inc = e.income;
      }
      if (e.unit && e.unit !== 'minion') s.u = e.unit;
      if (e.bw) { s.b = BULWARK_TYPES.indexOf(e.bw.type); s.lv = e.bw.level; s.o = e.bw.owner; }
      if (e.kind === 'tower') s.tr = e.tier;
      if (e.fx) s.fx = e.fx;
      ents.push(s);
    }
    const snap: Snapshot = { tick: this.tick, ents, ev: this.events, wv: this.wave, nw: Math.ceil(this.ticksToNextWave() / TICK_RATE) };
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
        case 'build': { const why = this.tryBuild(hero, cmd.kind, cmd.x, cmd.y); if (why) this.events.push({ e: 'deny', s: hero.id, why }); break; }
        case 'upgrade': { const why = this.tryUpgrade(hero, cmd.id); if (why) this.events.push({ e: 'deny', s: hero.id, why }); break; }
        case 'sell': { const why = this.trySell(hero, cmd.id); if (why) this.events.push({ e: 'deny', s: hero.id, why }); break; }
        case 'send': { const why = this.trySend(hero, cmd.unit, cmd.lane); if (why) this.events.push({ e: 'deny', s: hero.id, why }); break; }
      }
    }
  }

  /** Server-side validation of attack/ability requests: alive, not stunned/busy, cooldown ready, finite aim. */
  private tryAct(e: Entity, slot: number, aim: number, tx?: number, ty?: number): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot > 3 || !Number.isFinite(aim)) return false;
    if (e.deadTicks || e.stunTicks > 0 || e.action || e.dash || e.cds![slot]! > 0) return false;
    const def = HEROES[e.heroId!]!;
    const windup = slot === 0 ? def.attack.windup : def.abilities[slot - 1]!.windup;
    let px = Number.isFinite(tx) ? tx! : e.pos.x, py = Number.isFinite(ty) ? ty! : e.pos.y;
    if (slot > 0) {
      const ab = def.abilities[slot - 1]!;
      if (ab.kind === 'groundAoe') { // clamp target to cast range
        const d = Math.hypot(px - e.pos.x, py - e.pos.y), r = ab.range ?? 0;
        if (d > r) { px = e.pos.x + ((px - e.pos.x) / d) * r; py = e.pos.y + ((py - e.pos.y) / d) * r; }
      }
    }
    e.action = { slot, ticks: T(windup), aim, tx: px, ty: py };
    e.cds![slot] = T(slot === 0 ? def.attack.cooldown : def.abilities[slot - 1]!.cooldown);
    e.facing = aim;
    this.events.push({ e: 'act', s: e.id, a: slot, y: round2(aim) });
    if (slot > 0 && def.abilities[slot - 1]!.kind === 'groundAoe') {
      const ab = def.abilities[slot - 1]!;
      this.events.push({ e: 'tele', s: e.id, x: round2(px), y: round2(py), r: ab.radius ?? 1, d: round2(ab.windup + (ab.delay ?? 0)) });
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
    if (e.action && e.stunTicks > 0) e.action = undefined; // stuns interrupt
    if (e.action && --e.action.ticks <= 0) this.resolveAction(e);
    if (e.dash) { this.stepDash(e); this.consumeInput(e); return; }
    const next = this.consumeInput(e);
    if (e.stunTicks > 0) { e.moving = false; return; }
    const { mx, my } = next;
    if (mx === 0 && my === 0) {
      if (e.path.length) this.integrate(e); else e.moving = false;
      return;
    }
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
    if (e.action && e.kind === 'hero') m *= e.action.slot === 0 ? HEROES[e.heroId!]!.attack.moveMul : 0.5;
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
        for (const t of this.enemiesInCone(e, a.aim, atk.range, atk.angle ?? 1)) this.damage(t, dmg, e, 0);
      } else {
        this.spawnProjectile(e, a.aim, atk.projSpeed ?? 30, atk.range, dmg, 0.35, undefined, `${def.id}_basic`);
      }
      return;
    }
    const ab = def.abilities[a.slot - 1]!;
    const dmg = ab.damage + ab.damagePerLevel * lvl;
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
      case 'selfAoe':
        for (const t of this.entities.values()) {
          if (!this.targetable(t) || dist(t.pos, e.pos) > (ab.radius ?? 5) + t.radius) continue;
          if (t.team !== e.team) this.applyAbility(t, ab, dmg, e);
          else if (ab.allyHaste && t.kind === 'hero') { t.hasteTicks = T(ab.allyHaste.dur); t.hastePct = ab.allyHaste.pct; }
        }
        this.events.push({ e: 'aoe', s: e.id, x: round2(e.pos.x), y: round2(e.pos.y), r: ab.radius ?? 5 });
        break;
      case 'groundAoe':
        this.aoes.push({ owner: e.id, team: e.team, x: a.tx, y: a.ty, ticks: T(ab.delay ?? 0.5), ability: ab, dmg });
        break;
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
    e.pos = this.spawnPoint(e.team);
    e.hp = e.maxHp; e.deadTicks = 0; e.stunTicks = e.slowTicks = e.hasteTicks = 0;
    e.action = undefined; e.dash = undefined; e.path = []; e.inputs!.length = 0; e.input = { mx: 0, my: 0 };
    this.events.push({ e: 'spawn', s: e.id });
  }

  private spawnPoint(team: Team): Vec2 {
    const base = this.map.bases[team].pos;
    const n = [...this.entities.values()].filter((e) => e.kind === 'hero' && e.team === team).length;
    const ang = (n / 5) * Math.PI * 2 + 0.4;
    return { ...(this.nav.nearestWalkable({ x: base.x + Math.cos(ang) * 4.5, y: base.y + Math.sin(ang) * 4.5 }) ?? base) };
  }

  private inOwnFort(e: Entity): boolean { return dist(e.pos, this.map.bases[e.team].pos) < this.map.bases[e.team].radius; }

  // ---- Damage & status ----------------------------------------------------------------------

  private targetable(t: Entity): boolean { return t.kind !== 'projectile' && !t.deadTicks && t.hp > 0 && !t.invulnerable; }

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

  private applyAbility(t: Entity, ab: AbilityDef, dmg: number, src: Entity): void {
    if (dmg > 0) this.damage(t, dmg, src, 1);
    if (t.hp <= 0 || t.deadTicks || t.kind === 'tower' || t.kind === 'heart' || t.kind === 'bulwark') return;
    if (ab.stun) t.stunTicks = Math.max(t.stunTicks, T(ab.stun));
    if (ab.slow && (t.slowTicks <= 0 || ab.slow.pct >= t.slowPct)) { t.slowTicks = T(ab.slow.dur); t.slowPct = ab.slow.pct; }
  }

  /** All damage flows through here: events, kill credit, XP, death handling. kind: 0 basic, 1 ability, 2 structure. */
  private damage(t: Entity, amount: number, src: Entity | undefined, kind: 0 | 1 | 2): void {
    if (!this.targetable(t)) return;
    t.hp -= amount;
    if (src) t.lastHitBy = src.id;
    this.events.push({ e: 'hit', s: src?.id ?? 0, d: t.id, n: Math.round(amount), k: kind });
    if (t.hp <= 0) this.kill(t, src);
  }

  private kill(t: Entity, src: Entity | undefined): void {
    t.hp = 0;
    this.events.push({ e: 'die', s: src?.id ?? 0, d: t.id });
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
        t.action = undefined; t.dash = undefined; t.moving = false;
        break;
      case 'heart':
        this.entities.delete(t.id);
        this.winner = t.team === 0 ? 1 : 0;
        this.overTicks = T(12);
        this.events.push({ e: 'win', t: this.winner });
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

  private grantXp(h: Entity, amount: number): void {
    if ((h.level ?? 1) >= MAX_LEVEL) return;
    h.xp = (h.xp ?? 0) + amount;
    while ((h.level ?? 1) < MAX_LEVEL && h.xp >= xpForLevel(h.level ?? 1)) {
      h.xp -= xpForLevel(h.level ?? 1);
      h.level = (h.level ?? 1) + 1;
      const def = HEROES[h.heroId!]!;
      h.maxHp += def.hpPerLevel; h.hp += def.hpPerLevel; h.damage += def.damagePerLevel;
      this.events.push({ e: 'lvl', s: h.id, l: h.level });
    }
  }

  private tickStatus(e: Entity): void {
    if (e.stunTicks > 0) e.stunTicks--;
    if (e.slowTicks > 0) e.slowTicks--;
    if (e.hasteTicks > 0) e.hasteTicks--;
    if (e.atkTicks > 0) e.atkTicks--;
  }

  // ---- Projectiles & ground AoEs ------------------------------------------------------------

  private spawnProjectile(e: Entity, aim: number, speed: number, range: number, dmg: number, width: number, ab: AbilityDef | undefined, fx: string, homing?: number): void {
    const dx = Math.cos(aim), dy = Math.sin(aim);
    this.add({
      kind: 'projectile', team: e.team, pos: { x: e.pos.x + dx * 0.8, y: e.pos.y + dy * 0.8 }, facing: aim, radius: 0.1, speed,
      hp: 1, maxHp: 1, path: [], moving: true, damage: dmg, atkTicks: 0, stunTicks: 0, slowTicks: 0, slowPct: 0, hasteTicks: 0, hastePct: 0,
      proj: { owner: e.id, vx: dx * speed * DT, vy: dy * speed * DT, life: Math.ceil((range / speed) * TICK_RATE), dmg, width, ability: ab, homing }, fx,
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
    let best: Entity | null = null, bestT = Infinity;
    for (const t of this.entities.values()) {
      if (t.team === p.team || !this.targetable(t)) continue;
      const abx = b.x - a.x, aby = b.y - a.y, l2 = abx * abx + aby * aby;
      const k = l2 ? clamp(((t.pos.x - a.x) * abx + (t.pos.y - a.y) * aby) / l2, 0, 1) : 0;
      const d = Math.hypot(t.pos.x - (a.x + abx * k), t.pos.y - (a.y + aby * k));
      if (d <= t.radius + pr.width && k < bestT) { best = t; bestT = k; }
    }
    if (best) {
      const src = this.entities.get(pr.owner);
      if (pr.ability && src) this.applyAbility(best, pr.ability, pr.dmg, src); else this.damage(best, pr.dmg, src, 0);
      this.events.push({ e: 'pop', s: p.id, x: round2(best.pos.x), y: round2(best.pos.y), fx: p.fx });
      this.entities.delete(p.id);
      return;
    }
    p.pos = b;
    if (--pr.life <= 0 || !this.nav.isWalkable(b) && this.map.obstacles.some((o) => (o.kind === 'rock' || o.kind === 'wall' || o.kind === 'tower') && dist(o, b) < o.r)) {
      this.events.push({ e: 'pop', s: p.id, x: round2(b.x), y: round2(b.y), fx: p.fx });
      this.entities.delete(p.id);
    }
  }

  private stepAoes(): void {
    for (const a of [...this.aoes]) {
      if (--a.ticks > 0) continue;
      this.aoes.splice(this.aoes.indexOf(a), 1);
      const src = this.entities.get(a.owner);
      const r = a.ability?.radius ?? a.r ?? 3;
      for (const t of this.entities.values()) {
        if (t.team === a.team || !this.targetable(t) || t.kind === 'heart') continue;
        if (dist(t.pos, a) > r + t.radius) continue;
        if (a.ability && src) this.applyAbility(t, a.ability, a.dmg, src);
        else if (!a.ability && (t.kind === 'minion' || t.kind === 'hero')) this.damage(t, a.dmg, src, 2);
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
    for (const h of this.entities.values()) if (h.kind === 'hero') h.gold! += h.income!;
    this.events.push({ e: 'wave', n: this.wave });
    const hpMul = 1 + WAVES.hpGrowth * (this.wave - 1), dmgMul = 1 + WAVES.dmgGrowth * (this.wave - 1);
    for (const team of [0, 1] as const) for (const lane of ['top', 'mid', 'bot'] as const) {
      const units: UnitType[] = Array(WAVES.perLane).fill('minion');
      if (this.wave % WAVES.bossEvery === 0) units.push('troll');
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
      this.entities.delete(e.id);
      enemyHeart.hp -= def.leak;
      this.events.push({ e: 'hit', s: e.id, d: enemyHeart.id, n: def.leak, k: 0 });
      if (enemyHeart.hp <= 0) this.kill(enemyHeart, undefined);
      return;
    }
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
    let count = 0;
    for (const e of this.entities.values()) {
      if (e.kind === 'bulwark' && e.team === h.team) count++;
      if ((e.kind === 'hero' && !e.deadTicks) || e.kind === 'minion') if (Math.abs(e.pos.x - x) < 1 + e.radius && Math.abs(e.pos.y - y) < 1 + e.radius) return 'units in the way';
      if (e.kind === 'bulwark' && e.pos.x === x && e.pos.y === y) return 'occupied';
    }
    if (count >= ECON.maxPerTeam) return 'structure limit reached';
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
    const lvl = def.levels[0];
    const b = this.add({ kind: 'bulwark', team: h.team, pos: { x, y }, facing: h.team === 0 ? Math.PI / 4 : -3 * Math.PI / 4, radius: 1, speed: 0, hp: lvl.hp, maxHp: lvl.hp,
      path: [], moving: false, damage: lvl.damage ?? 0, atkTicks: 0, stunTicks: 0, slowTicks: 0, slowPct: 0, hasteTicks: 0, hastePct: 0,
      invulnerable: def.type === 'spikes', bw: { type: def.type, level: 1, owner: h.owner!, cells: def.blocks ? cells : [], charges: lvl.charges ?? 0 } });
    this.events.push({ e: 'build', s: b.id, b: BULWARK_TYPES.indexOf(def.type), x, y });
    return null;
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
    const frac = b.hp / b.maxHp;
    b.bw!.level++; b.maxHp = next.hp; b.hp = Math.max(1, Math.round(next.hp * frac)); b.damage = next.damage ?? 0;
    if (next.charges) b.bw!.charges = next.charges;
    this.events.push({ e: 'build', s: b.id, b: BULWARK_TYPES.indexOf(b.bw!.type), x: b.pos.x, y: b.pos.y, lv: b.bw!.level });
    return null;
  }

  private trySell(h: Entity, id: number): string | null {
    const b = this.ownStructure(h, id);
    if (typeof b === 'string') return b;
    h.gold! += Math.floor(investedIn(b.bw!.type, b.bw!.level) * ECON.sellRefund * (b.bw!.type === 'spikes' ? 1 : b.hp / b.maxHp));
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
    h.gold! -= s.cost; h.income! += s.income;
    for (let i = 0; i < s.count; i++) q.push(s.unit);
    this.events.push({ e: 'send', s: h.id, u: unit, l: lane });
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
        if (dist(t.pos, bn) <= bn.r + t.radius) this.damage(t, bn.dps / 3, src, 2);
      }
    }
  }

  /** Gold: last-hitting hero (or the owner of the structure that killed it) gets the bounty; otherwise nearby heroes share. */
  private payBounty(t: Entity, src: Entity | undefined): void {
    let bounty = 0;
    if (t.kind === 'minion') bounty = UNITS[t.unit ?? 'minion'].bounty;
    else if (t.kind === 'hero') bounty = ECON.heroBounty;
    else if (t.kind === 'bulwark') bounty = Math.round(investedIn(t.bw!.type, t.bw!.level) * ECON.bulwarkBountyFrac);
    else if (t.kind === 'tower') { for (const h of this.entities.values()) if (h.kind === 'hero' && h.team !== t.team) h.gold! += ECON.gateTowerTeam; return; }
    if (!bounty) return;
    const credit = src?.kind === 'hero' ? src : src?.kind === 'bulwark' ? this.heroOf(src.bw!.owner) : undefined;
    if (credit && credit.team !== t.team) { credit.gold! += bounty; this.events.push({ e: 'gold', s: credit.id, n: bounty, d: t.id }); return; }
    const near = [...this.entities.values()].filter((h) => h.kind === 'hero' && h.team !== t.team && !h.deadTicks && dist(h.pos, t.pos) < ECON.shareRadius);
    for (const h of near) h.gold! += (bounty * ECON.bountyShare) / near.length;
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

const KIND_CODE: Record<EntityKind, EntitySnapshot['k']> = { hero: 0, minion: 1, tower: 2, projectile: 3, heart: 4, bulwark: 5 };
const round2 = (v: number) => Math.round(v * 100) / 100;
export type { HeroDef };
