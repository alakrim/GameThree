# Technical Architecture

## Stack decisions

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) everywhere | One language for client, server and shared simulation; shared code is the biggest win for a server-authoritative game. |
| Rendering | Three.js (WebGL2 today) | Mature, small, huge ecosystem, works on every mobile browser. Materials are isolated in `client/src/render/toon.ts` so the `three/webgpu` + TSL migration is a contained change. |
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

## Netcode

Current:
- Snapshots at 15 Hz (`SNAPSHOT_EVERY = 2`), JSON with compact keys.
- Client renders 2 snapshot intervals in the past with linear interpolation (`net/interp.ts`).
- Immediate local feedback (move marker) masks latency.
- `LocalTransport` runs the same `World` in-page so offline practice and online play share one code path.

Planned (M3):
1. Client-side prediction + reconciliation for the local hero (re-simulate from last acked command).
2. Binary codec + delta compression against the last acknowledged snapshot.
3. Per-client interest management / fog-of-war culling (never send what the player cannot see — anti-cheat).
4. Lobby, matchmaking, reconnection, server-side replays from command logs.
5. Run the offline `World` in a Web Worker.

## Rendering

- Cel shading: `MeshToonMaterial` with a 3-band ramp + injected Fresnel rim light.
- Ink outlines: inverted hull on welded-normal geometry (works for faceted meshes), instanced for environment.
- Environment heavily instanced (trees, rocks, lantern posts): draw calls stay in the low hundreds.
- Quality tiers (`render/quality.ts`): DPR cap, MSAA, bloom, shadows, terrain density. A runtime governor drops tiers if
  FPS stays under 45.
- Coordinate convention: sim `(x, y)` → world `(x, 0, -y)`, via `toWorld()` only.

## Performance budgets (targets)

| | Low (phone) | Medium | High |
|---|---|---|---|
| Frame | 33 ms (30 fps) | 16.6 ms | 16.6 ms |
| Draw calls | < 150 | < 300 | < 500 |
| Server tick | < 3 ms per room (10 heroes + waves) | | |
