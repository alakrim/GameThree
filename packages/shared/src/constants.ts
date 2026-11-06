/** Simulation runs at a fixed rate on the server (and on the client for offline / prediction). */
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
/** Snapshot broadcast rate (every N ticks). 2 => 15 Hz. */
export const SNAPSHOT_EVERY = 2;
export const PROTOCOL_VERSION = 2;
