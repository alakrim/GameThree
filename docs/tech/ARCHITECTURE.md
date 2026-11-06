# Technical Architecture

## Stack decisions

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) everywhere | One language for client, server and shared simulation; shared code is the biggest win for a server-authoritative game. |
| Rendering | Three.js (WebGL2 today), PBR | Mature, small, works on every mobile browser. Custom shader code is confined to `render/terrain.ts`, `foliage.ts`, `fire.ts`, `post.ts` so a `three/webgpu` + TSL migration is a contained change. |
| Assets | CC0 (ambientCG, Poly Haven) via `tools/assets/fetch-assets.mjs` | Reproducible: download → simplify/LOD → meshopt + WebP → `packages/client/public/assets`, credits auto-generated. |
| Build | Vite | Fast HMR, ES2022 output, trivial static hosting. |
| Server | Node 22 + `ws` | Same simulation code as the client; one process hosts many rooms. Horizontal scale = more processes behind a matchmaker. |
| Tests | Vitest (unit/sim), Playwright (browser smoke) | Simulation is pure so it is unit-tested heavily; the browser test asserts the real game boots and responds to input. |
| Mobile | Capacitor (planned) | Wraps the same web build for Android/iOS; touch input and responsive HUD exist from day one. |

## Packages

```
packages/
  shared/   Deterministic simulation: map, nav grid + A*, World, protocol. No DOM, no Node APIs.
  server/   Authoritative match server: Room (transport-agnostic), WebSocket entrypoint, fixed-tick loop.
  client/   Three.js renderer, camera, input, HUD, transports, snapshot interpolation.
qa/         Browser smoke test (Playwright).
```

## Simulation

- Fixed 30 Hz tick (`TICK_RATE`), seeded RNG, no wall-clock reads → deterministic given the same command stream
  (asserted by `World.hash()` in tests). This enables replays, desync detection and server-side "time" mechanics.
- Clients send **commands only** (`move`, `stop`, … abilities next). The server validates (schema, finite numbers,
  per-tick rate limit) and is the only source of truth.
- Map is generated from a seed and **point-mirrored** so both teams get identical terrain (tested).
- Navigation: 1-unit walkability grid baked from the map, 8-way A* without corner cutting, then line-of-sight string
  pulling. ~0.15 ms/tick for 80 units (0.4% of the tick budget; `npm run bench`).

## Camera & controls (action-MOBA model)

Third-person over-the-shoulder camera with first-person zoom (`render/camera.ts`): yaw/pitch orbit, right-shoulder
offset, boom shortened by terrain collision. Movement is direct analog input relative to the camera
(WASD / left virtual stick); looking is mouse (pointer lock) or right-thumb drag. Abilities will aim from the camera ray.

## Combat model (server-authoritative, twist-agnostic)

- **Data-driven kits** (`shared/src/heroes.ts`): each hero = stats + basic attack + Q/E/R `AbilityDef`s. The sim
  interprets six generic ability kinds — `dash`, `cone`, `projectile`, `groundAoe`, `selfAoe`, `trap` — plus optional
  modifiers: damage, stun, root, slow, ally haste, stop-on-first-hit, projectile `targets` (`enemy` / `ally` / `any`),
  `heroOnly` (hooks), `pull` / `pullToCaster` (stun on arrival), `push`, `splashSlow`, `split` (forking arrows),
  `pulses` (volleys), `heal`, `shield`, `allyHot`, `structureMul`, and basic-attack `reelEvery`. Five heroes ship
  (Hrodvar, Sigrun, Hilde, Brynna, Halla) with no hero-specific code paths in the sim.
- **Status system:** stun, root (no movement or dashes; attacks allowed), slow (60% stacking cap), haste, shield
  (absorbs before HP, expires), heal-over-time, and **forced movement** (pulls, pushes, reels — the victim can't act;
  walls and palisades stop it). Hard CC on heroes has **diminishing returns** (HEROES.md §6.4): 100%, then 50%, then
  3 s immunity, inside a 6 s window. All of it is visible to clients as `st` bits (see `EntitySnapshot`).
- **Actions**: `act {slot, aim, tx, ty}` is validated server-side (alive, not stunned/busy, cooldown ready, finite aim,
  ground target clamped to range), then runs a wind-up (telegraph) before resolving. Stuns interrupt wind-ups.
- **Hit detection**: cones test range + half-angle; projectiles are swept per tick (no tunnelling) and resolve every
  candidate along the segment in order, so an `any` beam can heal an ally and burn an enemy in one tick; ground AoEs
  detonate after a delay (or pulse) with a broadcast telegraph.
- **Heroes vs structures** (TWIST_BULWARKS §9): area damage (ground/self AoE, splash, burns) deals 50% to structures;
  enemy palisades absorb ground skillshots — hooks and ally threads stop on them; arcing volleys ignore walls;
  heals never repair structures. Repairs are a separate, paid channel (below).
- **Damage pipeline** (`World.damage`): structure rules → item modifiers (structure damage, armor) → shield absorb →
  HP → combat timers, assist tracking, telemetry, lifesteal → death (kill credit, assists, bounties, XP).
- **Structures**: 2 towers per lane per team + a Heartstone per fort. Towers prioritise minions, then heroes, and fire
  homing bolts. Inner towers are invulnerable until their lane's outer tower falls; the Heartstone until an inner
  tower falls. Destroying a Heartstone wins; the match resets after 12 s.
- **Minions** aggro the nearest enemy (preferring minions/structures), leash back to their lane.
- **Progression**: shared XP for nearby kills, levels 1–12 scaling HP/damage, respawn timer by level, fort regen.
- **Bots** (`shared/src/bot.ts`) fill empty slots to 3v3 with a varied line-up (no duplicates per team). They issue
  the same commands as players (no special access): follow their lane behind allied minions (a Mystic duos with the
  team's ranged carry), avoid diving towers unless grouped, cast kit-aware (hooks only at heroes, heals and shields
  onto hurt allies, rings when the team is hurt), retreat, recall to shop, buy a role build, repair, and from minute 12
  — or once an enemy gate falls — group up and siege the weakest lane.
- **Events** (`GameEvent` in snapshots): `act`, `hit`, `die`, `lvl`, `tele`, `aoe`, `pop`, `spawn`, `win`, `reset`,
  plus `heal`, `shield`, `hook`, `snare`, `push`, `imm`, `buy`, `kill` (kill feed with assists) and `recall`.
  The client releases each event when interpolated render time reaches its tick, so VFX/SFX line up with motion;
  the local player's own actions play instantly on input.

## Bulwarks (core twist: MOBA + tower defence)

Design: `docs/design/TWIST_BULWARKS.md`. Data: `shared/src/bulwarks.ts`. Logic: `World` (build/upgrade/sell/send,
`stepBulwark`, flow-field minions, leaks, bounties) and `BotBrain.economy`.

- **Dynamic navigation:** structures occupy a 2 m × 2 m footprint on the 1 m nav grid via a reference-counted
  `blocked` layer. Clients mirror it from snapshots, so prediction never walks through a palisade.
- **Mazing:** wave units follow one of six flow fields (attacker team × lane), computed by a weighted Dijkstra
  toward the defender's Heartstone. Off-lane cells cost 3×, so waves stay in their lane and wind through mazes,
  detouring through the forest only when a lane is heavily walled. Typed-array heap, no allocation in the hot loop:
  ~4.5 ms per field. Changes only dirty the 3 fields of the attacking team, and at most one field is rebuilt per
  tick (worst steady-state tick ≈ 16 ms in a 5-minute 3v3 with bots building).
- **No sealing:** a blocking placement is accepted only if every enemy lane spawn can still reach the Heartstone (BFS).
- **Server validation:** grid snap, own territory (≥ 10 m closer to own Heartstone), not near forts, free ground,
  no units in the footprint, within 14 m of the builder, gold, per-team cap. Refusals return a `deny` event with a reason.
- **Economy:** passive gold, per-wave income (raised by sends), last-hit bounties (structures credit their owner),
  shared bounties otherwise. Leaks damage the Heartstone directly; heroes can hit it only after a gate tower falls.

## Items, repair, recall (M1c)

- **Items v0** (`shared/src/items.ts`, `docs/design/ITEMS.md`): nine passive items, four slots, bought and sold
  (60%) only inside your own fort or while dead. Stats are summed once per change (`recalcHero`) into `ist` and read
  in hot paths: max HP / attack damage, move speed (in `speedMul`, so prediction sees it via `sm`), cooldown reduction,
  ability power, lifesteal, out-of-combat regen, structure damage, armor, repair speed.
- **Repair:** `repair {id}` channels on a friendly bulwark within 4.5 m (not Caltrops, not gate towers): 7% max HP/s,
  a full repair costs 45% of the gold invested. Moving, acting, stuns and hits from heroes or towers break it.
- **Hearth Recall:** `recall` channels 4 s, then returns the hero to their spawn slot; moving, acting or any damage
  cancels it. Spawn slots fan out on the gate side of the Heartstone.
- **Structure caps:** 10 per hero and 40 per team, so a player joining a bot-filled match always has an allowance.

## Telemetry & balance tooling

- `shared/src/telemetry.ts` keeps a per-match ledger fed by the World (never read by the sim, so determinism is
  untouched): per hero K/D/A, last hits, damage to heroes / units / structures, damage taken, healing, shielding,
  hard CC dealt, gold earned and spent by category (build, upgrade, send, item, repair), structures built, items,
  ability casts; per match leaks by unit/lane, Heartstone HP per minute, first gate tower, structures lost,
  rejections by reason, sells, troll kills. `World.matchSummary()` reads it at any time; `onMatchEnd` fires once.
- The server logs one line per finished match. `npm run balance -- [matches] [out.md] [capMinutes]` plays headless
  3v3 bot matches with random rosters on all cores (worker threads) and writes `docs/balance/REPORT.md` + JSON.

## Netcode

- **Input:** the client sends one `input {seq, mx, my}` per 30 Hz tick (idle inputs suppressed after 3). The server
  buffers ≤ 8 per hero and consumes exactly one per tick, repeating the last one for ≤ 6 ticks if the stream stalls
  (then stops the hero — no runaway characters on tab-out). Input vectors are clamped server-side (speed-hack proof).
- **Prediction/reconciliation** (`net/prediction.ts`): the client moves its own hero immediately with the *same*
  `moveWithCollision` the server uses. Each snapshot carries the hero's last processed `seq`; the client rewinds to the
  authoritative position, replays un-acked inputs, and hides the residual error with a decaying visual offset.
  Server/client parity is unit-tested (identical positions after 90 ticks).
- **Remote entities:** snapshots at 15 Hz, rendered 2 intervals in the past with interpolation (`net/interp.ts`).
- `LocalTransport` runs the same `World` in-page so offline practice and online play share one code path.

- Prediction pauses while the server drives the hero (stunned, dashing, dead) and uses the server's current
  movement multiplier (slows/hastes/attack wind-up) so corrections stay small.

Planned (M3):
1. Lag-compensated hit detection for camera-aimed abilities (server rewinds hitboxes by the shooter's RTT).
2. Binary codec + delta compression against the last acknowledged snapshot.
3. Per-client interest management / fog-of-war culling (never send what the player cannot see — anti-cheat).
4. Lobby, matchmaking, reconnection, server-side replays from command logs.
5. Run the offline `World` in a Web Worker.

## Rendering

- PBR (`MeshStandardMaterial`) lit by an HDRI (image-based lighting) plus a sun aligned to the HDRI's brightest texel;
  ACES tone mapping, exponential fog matched to the sky's horizon colour, colour grade + vignette pass, bloom only on
  fire/runes.
- Terrain: one mesh, ~1 m cells in the valley stretching to coarse cells for the mountains; heights come from the
  shared deterministic `terrainHeight()` so server and client agree. Fragment shader splats grass / forest floor /
  rock (triplanar) / snow / gravel road / cobble by slope, height and lane/river/fort masks, with blended normal maps.
- Foliage: procedural pines (real bark texture + painted alpha needle cards, wind sway, alpha-tested shadows),
  grass tufts, drifting snow. All instancing is **spatially chunked** so frustum culling (and the shadow pass) skip
  off-screen cells.
- Props: CC0 photoscanned boulders with generated LODs, logs, braziers with shader fire + flickering lights,
  slate forts with gate towers and waving banners.
- Characters: articulated rig with PBR armour and CC0 weapons, procedural locomotion driven by actual ground speed.
  Stand-in until skinned hero models arrive; the `Character.update(speed)` driver interface stays.
- Quality tiers (`render/quality.ts`): DPR, MSAA, shadow map size, grass and tree counts, lights, post FX.
  A runtime governor sheds DPR, then post FX, under sustained < 40 fps.
- Coordinate convention: sim `(x, y)` → world `(x, h, -y)`, via `toWorld()` only.

## Performance budgets (targets)

| | Low (phone) | Medium | High |
|---|---|---|---|
| Frame | 33 ms (30 fps) | 16.6 ms | 16.6 ms |
| Draw calls | < 150 | < 300 | < 500 |
| Triangles on screen | < 300k | < 800k | < 1.5M |
| Server tick | < 3 ms per room (10 heroes + waves) | | |
