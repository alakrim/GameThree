import { WebSocketServer, type WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { decodeClient, encode, DT } from '@lumen/shared';
import { Room } from './room.js';

const PORT = Number(process.env.PORT ?? 8787);
const wss = new WebSocketServer({ port: PORT, maxPayload: 4 * 1024 });
const room = new Room(Number(process.env.SEED ?? 1337));

wss.on('connection', (ws: WebSocket) => {
  const id = randomUUID().slice(0, 8);
  let joined = false;
  ws.on('message', (data) => {
    const msg = decodeClient(data.toString());
    if (!msg) return;
    if (msg.op === 'hello' && !joined) {
      joined = room.join({ id, send: (m) => ws.readyState === ws.OPEN && ws.send(encode(m)) }, msg.hero);
      if (!joined) ws.close();
      else console.log(`[room] ${msg.name} (${id}) joined — ${room.size} players`);
      return;
    }
    if (joined) room.handle(id, msg);
  });
  ws.on('close', () => { if (joined) { room.leave(id); console.log(`[room] ${id} left — ${room.size} players`); } });
});

// Fixed-timestep loop with drift correction.
let next = performance.now();
const loop = () => {
  const now = performance.now();
  let steps = 0;
  while (now >= next && steps < 5) { room.step(); next += DT * 1000; steps++; }
  if (steps === 5) next = now; // overloaded: drop backlog rather than spiral
  setTimeout(loop, Math.max(0, next - performance.now()));
};
loop();
console.log(`[lumen] authoritative server on ws://localhost:${PORT}`);
