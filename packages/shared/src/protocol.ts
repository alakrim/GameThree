import { PROTOCOL_VERSION } from './constants.js';

/** Player intents. Clients never send state, only commands; the server is authoritative and validates everything. */
export type Command =
  /** Direct analog movement (WASD / stick) for the current tick. `seq` lets the client reconcile its prediction. */
  | { type: 'input'; seq: number; mx: number; my: number }
  /** Basic attack (slot 0) or ability Q/E/R (slots 1-3), aimed along `aim` (sim radians); tx/ty = ground target. */
  | { type: 'act'; slot: number; aim: number; tx?: number; ty?: number }
  /** Pathfinding move order (bots, click-to-move fallback). */
  | { type: 'move'; x: number; y: number }
  | { type: 'stop' };

/** Compact entity record. Short keys keep JSON small until the binary codec lands. */
export interface EntitySnapshot {
  id: number;
  k: 0 | 1 | 2 | 3 | 4; // hero, minion, tower, projectile, heart
  t: 0 | 1; // team
  x: number; y: number; f: number;
  hp: number; mh: number;
  m: 0 | 1; // moving
  st?: number; // status bits: 1 stunned, 2 slowed, 4 dead, 8 hasted, 16 invulnerable, 32 dashing
  o?: string; // owner player id
  h?: string; // hero id
  sq?: number; // last input seq processed — prediction ack
  lv?: number; xp?: number; // level, progress to next (0..1)
  cd?: number[]; // cooldowns remaining [basic, Q, E, R] in tenths of a second
  sm?: number; // current movement speed multiplier (prediction)
  rs?: number; // respawn seconds remaining
  tr?: number; // tower tier
  fx?: string; // projectile visual id
}

/** Discrete things that happened since the last snapshot (drive VFX, SFX, animation, damage numbers). */
export type GameEvent =
  | { e: 'act'; s: number; a: number; y: number }                        // attack/ability started (slot a, aim y)
  | { e: 'hit'; s: number; d: number; n: number; k: 0 | 1 | 2 }           // damage n from s to d
  | { e: 'die'; s: number; d: number }
  | { e: 'lvl'; s: number; l: number }
  | { e: 'aoe'; s: number; x: number; y: number; r: number; fx?: string }  // area effect resolved
  | { e: 'tele'; s: number; x: number; y: number; r: number; d: number }  // telegraph: area resolves in d seconds
  | { e: 'pop'; s: number; x: number; y: number; fx?: string }            // projectile ended
  | { e: 'spawn'; s: number }
  | { e: 'win'; t: 0 | 1 }
  | { e: 'reset' };

export interface Snapshot { tick: number; ents: EntitySnapshot[]; ev?: GameEvent[]; win?: 0 | 1 }

export type ClientMsg =
  | { op: 'hello'; v: number; name: string; hero?: string }
  | { op: 'cmd'; seq: number; cmd: Command }
  | { op: 'ping'; t: number };

export type ServerMsg =
  | { op: 'welcome'; v: number; playerId: string; team: 0 | 1; seed: number; tick: number }
  | { op: 'snap'; s: Snapshot }
  | { op: 'pong'; t: number }
  | { op: 'error'; reason: string };

export const encode = (m: ClientMsg | ServerMsg): string => JSON.stringify(m);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optFinite = (v: unknown) => v === undefined || finite(v);

export function decodeClient(raw: string): ClientMsg | null {
  try {
    const m = JSON.parse(raw) as ClientMsg;
    switch (m?.op) {
      case 'hello': return typeof m.name === 'string' && m.v === PROTOCOL_VERSION && (m.hero === undefined || typeof m.hero === 'string') ? m : null;
      case 'ping': return finite(m.t) ? m : null;
      case 'cmd': {
        const c = m.cmd;
        if (c?.type === 'stop') return m;
        if (c?.type === 'input' && Number.isInteger(c.seq) && finite(c.mx) && finite(c.my)) return m;
        if (c?.type === 'act' && Number.isInteger(c.slot) && finite(c.aim) && optFinite(c.tx) && optFinite(c.ty)) return m;
        if (c?.type === 'move' && finite(c.x) && finite(c.y)) return m;
        return null;
      }
      default: return null;
    }
  } catch { return null; }
}

export function decodeServer(raw: string): ServerMsg | null {
  try { return JSON.parse(raw) as ServerMsg; } catch { return null; }
}
