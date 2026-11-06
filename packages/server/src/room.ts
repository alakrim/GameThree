import { World, SNAPSHOT_EVERY, HEROES, DEFAULT_HERO, type ClientMsg, type ServerMsg, type Team, PROTOCOL_VERSION } from '@lumen/shared';

export interface Peer { id: string; send(m: ServerMsg): void }

const MAX_PLAYERS = 10;
const MAX_CMDS_PER_TICK = 4; // per-player rate limit (anti-spam / anti-flood)
/** Empty slots are filled with bots so every match is 3v3 (humans replace bots as they join). */
const TEAM_SIZE = Number(process.env.TEAM_SIZE ?? 3);

/** One match. Transport-agnostic so it is unit-testable without sockets. */
export class Room {
  readonly world: World;
  private peers = new Map<string, { peer: Peer; team: Team; cmdsThisTick: number }>();

  constructor(readonly seed = 1337, teamSize = TEAM_SIZE) { this.world = new World({ seed, botsPerTeam: teamSize }); this.world.fillBots(); }

  get size() { return this.peers.size; }

  join(peer: Peer, heroId = DEFAULT_HERO): boolean {
    if (this.peers.size >= MAX_PLAYERS) { peer.send({ op: 'error', reason: 'room full' }); return false; }
    if (!HEROES[heroId]) heroId = DEFAULT_HERO;
    const dawn = [...this.peers.values()].filter((p) => p.team === 0).length;
    const team: Team = dawn <= this.peers.size - dawn ? 0 : 1;
    this.peers.set(peer.id, { peer, team, cmdsThisTick: 0 });
    this.world.spawnHero(peer.id, team, heroId);
    this.world.fillBots();
    peer.send({ op: 'welcome', v: PROTOCOL_VERSION, playerId: peer.id, team, seed: this.seed, tick: this.world.tick });
    return true;
  }

  leave(id: string) { this.peers.delete(id); this.world.removeOwner(id); this.world.fillBots(); }

  handle(id: string, msg: ClientMsg) {
    const p = this.peers.get(id);
    if (!p) return;
    if (msg.op === 'ping') p.peer.send({ op: 'pong', t: msg.t });
    else if (msg.op === 'cmd' && p.cmdsThisTick++ < MAX_CMDS_PER_TICK) this.world.queue(id, msg.cmd);
  }

  step() {
    this.world.step();
    for (const p of this.peers.values()) p.cmdsThisTick = 0;
    if (this.world.tick % SNAPSHOT_EVERY === 0) {
      // TODO(netcode): per-client fog-of-war culling + delta compression against last acked snapshot.
      const snap: ServerMsg = { op: 'snap', s: this.world.snapshot() };
      for (const p of this.peers.values()) p.peer.send(snap);
    }
  }
}
