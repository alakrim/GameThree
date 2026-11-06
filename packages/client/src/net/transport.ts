import { World, DT, SNAPSHOT_EVERY, encode, decodeServer, PROTOCOL_VERSION, type Command, type Snapshot, type ServerMsg } from '@lumen/shared';

export interface Welcome { playerId: string; team: 0 | 1; seed: number }

/** The client only ever talks to a Transport, so offline and online play share one code path. */
export interface Transport {
  readonly kind: 'local' | 'ws';
  onWelcome?: (w: Welcome) => void;
  onSnapshot?: (s: Snapshot) => void;
  onStatus?: (s: string) => void;
  rtt: number;
  send(cmd: Command): void;
  update(dtSec: number): void;
  close(): void;
}

/** Runs the authoritative World in-page (offline / practice). Same message flow as the network. */
export class LocalTransport implements Transport {
  readonly kind = 'local';
  onWelcome?: (w: Welcome) => void;
  onSnapshot?: (s: Snapshot) => void;
  onStatus?: (s: string) => void;
  rtt = 0;
  private world = new World({ seed: 1337 });
  private acc = 0;
  private started = false;

  send(cmd: Command) { this.world.queue('local', cmd); }

  update(dt: number) {
    if (!this.started) {
      this.started = true;
      this.world.spawnHero('local', 0);
      this.onStatus?.('offline practice');
      this.onWelcome?.({ playerId: 'local', team: 0, seed: 1337 });
    }
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= DT) {
      this.world.step();
      this.acc -= DT;
      if (this.world.tick % SNAPSHOT_EVERY === 0) this.onSnapshot?.(this.world.snapshot());
    }
  }
  close() {}
}

export class WsTransport implements Transport {
  readonly kind = 'ws';
  onWelcome?: (w: Welcome) => void;
  onSnapshot?: (s: Snapshot) => void;
  onStatus?: (s: string) => void;
  rtt = 0;
  private ws: WebSocket;
  private seq = 0;
  private pingTimer = 0;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => { this.onStatus?.('connected'); this.raw({ op: 'hello', v: PROTOCOL_VERSION, name: 'player' }); };
    this.ws.onclose = () => this.onStatus?.('disconnected');
    this.ws.onerror = () => this.onStatus?.('connection error');
    this.ws.onmessage = (ev) => {
      const m = decodeServer(String(ev.data)) as ServerMsg | null;
      if (!m) return;
      if (m.op === 'welcome') this.onWelcome?.({ playerId: m.playerId, team: m.team, seed: m.seed });
      else if (m.op === 'snap') this.onSnapshot?.(m.s);
      else if (m.op === 'pong') this.rtt = this.rtt ? this.rtt * 0.8 + (performance.now() - m.t) * 0.2 : performance.now() - m.t;
      else if (m.op === 'error') this.onStatus?.(`server: ${m.reason}`);
    };
  }
  private raw(m: Parameters<typeof encode>[0]) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(m)); }
  send(cmd: Command) { this.raw({ op: 'cmd', seq: ++this.seq, cmd }); }
  update(dt: number) {
    this.pingTimer -= dt;
    if (this.pingTimer <= 0) { this.pingTimer = 1; this.raw({ op: 'ping', t: performance.now() }); }
  }
  close() { this.ws.close(); }
}
