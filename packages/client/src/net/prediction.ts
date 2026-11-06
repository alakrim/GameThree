import { DT, moveWithCollision, HERO_SPEED, type NavGrid, type Vec2, type Command } from '@lumen/shared';

/**
 * Client-side prediction + server reconciliation for the local hero.
 * Runs the exact same fixed-step movement as the server; when an authoritative snapshot arrives,
 * rewinds to the server state and replays unacknowledged inputs. Visual error is smoothed out.
 */
export class Predictor {
  pos: Vec2 | null = null;
  facing = 0;
  private seq = 0;
  private acc = 0;
  private pending: { seq: number; mx: number; my: number }[] = [];
  private idleSent = 0;
  /** Visual-only correction offset that decays to zero. */
  readonly offset = { x: 0, y: 0 };

  constructor(private nav: NavGrid, private send: (c: Command) => void) {}

  step(dt: number, mx: number, my: number) {
    if (!this.pos) return;
    this.acc = Math.min(this.acc + dt, 0.2);
    while (this.acc >= DT) {
      this.acc -= DT;
      const idle = mx === 0 && my === 0;
      if (idle && this.idleSent >= 3) continue; // server stops us after a few idle ticks; save bandwidth
      this.idleSent = idle ? this.idleSent + 1 : 0;
      const seq = ++this.seq;
      this.send({ type: 'input', seq, mx, my });
      this.pending.push({ seq, mx, my });
      if (this.pending.length > 120) this.pending.shift();
      this.pos = moveWithCollision(this.nav, this.pos, mx * HERO_SPEED * DT, my * HERO_SPEED * DT);
      if (!idle) this.facing = Math.atan2(my, mx);
    }
    const k = Math.exp(-dt * 10);
    this.offset.x *= k; this.offset.y *= k;
  }

  reconcile(server: Vec2, ack: number) {
    if (!this.pos) { this.pos = { ...server }; return; }
    this.pending = this.pending.filter((p) => p.seq > ack);
    let p = { ...server };
    for (const i of this.pending) p = moveWithCollision(this.nav, p, i.mx * HERO_SPEED * DT, i.my * HERO_SPEED * DT);
    const ex = this.pos.x - p.x, ey = this.pos.y - p.y;
    if (Math.hypot(ex, ey) > 4) { this.offset.x = this.offset.y = 0; } // teleport-scale error: snap
    else { this.offset.x += ex; this.offset.y += ey; }
    this.pos = p;
  }

  get render(): Vec2 | null { return this.pos ? { x: this.pos.x + this.offset.x, y: this.pos.y + this.offset.y } : null; }
}
