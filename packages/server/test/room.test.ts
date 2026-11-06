import { describe, it, expect } from 'vitest';
import { Room } from '../src/room.js';
import type { ServerMsg } from '@lumen/shared';

const mkPeer = (id: string) => { const inbox: ServerMsg[] = []; return { peer: { id, send: (m: ServerMsg) => inbox.push(m) }, inbox }; };

describe('Room', () => {
  it('balances teams and welcomes players', () => {
    const r = new Room();
    const a = mkPeer('a'), b = mkPeer('b');
    r.join(a.peer); r.join(b.peer);
    const wa = a.inbox[0], wb = b.inbox[0];
    expect(wa?.op === 'welcome' && wb?.op === 'welcome' && wa.team !== wb.team).toBe(true);
  });
  it('broadcasts snapshots and applies commands server-side', () => {
    const r = new Room();
    const a = mkPeer('a'); r.join(a.peer);
    r.handle('a', { op: 'cmd', seq: 1, cmd: { type: 'move', x: -50, y: -40 } });
    for (let i = 0; i < 60; i++) r.step();
    const snaps = a.inbox.filter((m) => m.op === 'snap');
    expect(snaps.length).toBe(30);
    const last = snaps.at(-1)!;
    const me = last.op === 'snap' ? last.s.ents.find((e) => e.o === 'a') : undefined;
    expect(me).toBeDefined();
  });
  it('rate-limits command floods', () => {
    const r = new Room();
    const a = mkPeer('a'); r.join(a.peer);
    let queued = 0;
    const orig = r.world.queue.bind(r.world);
    r.world.queue = (...args) => { queued++; orig(...args); };
    for (let i = 0; i < 50; i++) r.handle('a', { op: 'cmd', seq: i, cmd: { type: 'stop' } });
    expect(queued).toBe(4);
  });
  it('removes hero on leave', () => {
    const r = new Room();
    const a = mkPeer('a'); r.join(a.peer); r.leave('a');
    expect([...r.world.entities.values()].some((e) => e.owner === 'a')).toBe(false);
  });
});
