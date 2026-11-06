import type { NavGrid } from './nav.js';
import type { Vec2 } from './math.js';

/**
 * Collision-aware step used by BOTH the server and client prediction, so predicted motion matches the authority.
 * Tries the full move, then each axis separately (wall sliding).
 */
export function moveWithCollision(nav: NavGrid, pos: Vec2, dx: number, dy: number): Vec2 {
  const full = { x: pos.x + dx, y: pos.y + dy };
  if (nav.isWalkable(full)) return full;
  const sx = { x: pos.x + dx, y: pos.y };
  if (dx !== 0 && nav.isWalkable(sx)) return sx;
  const sy = { x: pos.x, y: pos.y + dy };
  if (dy !== 0 && nav.isWalkable(sy)) return sy;
  return { x: pos.x, y: pos.y };
}

/** Clamp an analog input vector to length <= 1 (rejects NaN). */
export function sanitizeInput(mx: number, my: number): [number, number] {
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return [0, 0];
  const l = Math.hypot(mx, my);
  return l > 1 ? [mx / l, my / l] : [mx, my];
}
