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
