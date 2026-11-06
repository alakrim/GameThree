import { TICK_RATE, SNAPSHOT_EVERY, angleDelta, type Snapshot, type EntitySnapshot } from '@lumen/shared';

export interface InterpEntity extends EntitySnapshot { speed: number }

const SNAP_MS = (1000 / TICK_RATE) * SNAPSHOT_EVERY;

/**
 * Snapshot interpolation: render remote state slightly in the past (2 snapshot intervals)
 * so motion is smooth regardless of jitter. Client-side prediction for the local hero
 * is a planned follow-up (see docs/tech/ARCHITECTURE.md §Netcode).
 */
export class Interpolator {
  private buf: { t: number; s: Snapshot }[] = [];
  delayMs = SNAP_MS * 2;
  /** Server clock estimate: tick -> local ms. */
  private offset: number | null = null;

  push(s: Snapshot, now: number) {
    const tMs = (s.tick * 1000) / TICK_RATE;
    const est = now - tMs;
    this.offset = this.offset === null ? est : Math.min(est, this.offset * 0.95 + est * 0.05 + 0.5);
    this.buf.push({ t: tMs, s });
    if (this.buf.length > 30) this.buf.shift();
  }

  /** Most recent authoritative snapshot (used for prediction reconciliation). */
  get latest(): Snapshot | null { return this.buf.length ? this.buf[this.buf.length - 1]!.s : null; }

  /** Server time (ms) currently being rendered — events are released when this passes their tick. */
  renderTime(now: number): number { return this.offset === null ? -Infinity : now - this.offset - this.delayMs; }

  sample(now: number): Map<number, InterpEntity> {
    const out = new Map<number, InterpEntity>();
    if (!this.buf.length || this.offset === null) return out;
    const rt = now - this.offset - this.delayMs;
    let i = this.buf.length - 1;
    while (i > 0 && this.buf[i]!.t > rt) i--;
    const a = this.buf[i]!, b = this.buf[i + 1];
    if (!b) { for (const e of a.s.ents) out.set(e.id, { ...e, speed: 0 }); return out; }
    const t = Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t)));
    const prev = new Map(a.s.ents.map((e) => [e.id, e]));
    for (const e of b.s.ents) {
      const p = prev.get(e.id);
      if (!p) { out.set(e.id, { ...e, speed: 0 }); continue; }
      const dx = e.x - p.x, dy = e.y - p.y;
      out.set(e.id, { ...e, x: p.x + dx * t, y: p.y + dy * t, f: p.f + angleDelta(p.f, e.f) * t, hp: p.hp + (e.hp - p.hp) * t, speed: Math.hypot(dx, dy) / ((b.t - a.t) / 1000) });
    }
    return out;
  }
}
