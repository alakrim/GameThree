import { PROTOCOL_VERSION } from './constants.js';

/** Player intents. Clients never send state, only commands; the server is authoritative. */
export type Command =
  | { type: 'move'; x: number; y: number }
  | { type: 'stop' };

/** Compact entity record. Short keys keep JSON small until the binary codec lands. */
export interface EntitySnapshot {
  id: number;
  k: 0 | 1; // 0 hero, 1 minion
  t: 0 | 1; // team
  x: number; y: number; f: number;
  hp: number; mh: number;
  m: 0 | 1; // moving
  o?: string; // owner player id
  h?: string; // hero archetype id
}

export interface Snapshot { tick: number; ents: EntitySnapshot[] }

export type ClientMsg =
  | { op: 'hello'; v: number; name: string }
  | { op: 'cmd'; seq: number; cmd: Command }
  | { op: 'ping'; t: number };

export type ServerMsg =
  | { op: 'welcome'; v: number; playerId: string; team: 0 | 1; seed: number; tick: number }
  | { op: 'snap'; s: Snapshot }
  | { op: 'pong'; t: number }
  | { op: 'error'; reason: string };

export const encode = (m: ClientMsg | ServerMsg): string => JSON.stringify(m);

export function decodeClient(raw: string): ClientMsg | null {
  try {
    const m = JSON.parse(raw) as ClientMsg;
    switch (m?.op) {
      case 'hello': return typeof m.name === 'string' && m.v === PROTOCOL_VERSION ? m : null;
      case 'ping': return typeof m.t === 'number' ? m : null;
      case 'cmd': {
        const c = m.cmd;
        if (c?.type === 'stop') return m;
        if (c?.type === 'move' && Number.isFinite(c.x) && Number.isFinite(c.y)) return m;
        return null;
      }
      default: return null;
    }
  } catch { return null; }
}

export function decodeServer(raw: string): ServerMsg | null {
  try { return JSON.parse(raw) as ServerMsg; } catch { return null; }
}
