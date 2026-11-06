# Project Lumen

Browser-first, server-authoritative 3D MOBA set in the **Shoals of Aurel** — a floating archipelago over a sea of
luminous cloud. Visual direction: **"Lacquer & Light"** (see `docs/art/ART_BIBLE.md`).

> Current stage: **M0 Foundation**. Core gameplay twist pending selection — see `docs/design/TWIST_CONCEPTS.md`.

## Run

```bash
npm install
npm run dev            # client on http://localhost:5173 (offline practice: sim runs in-page)
npm run dev:server     # authoritative server on ws://localhost:8787
# then open http://localhost:5173/?server=ws://localhost:8787  (open several tabs to see other players)
```

URL options: `?quality=low|medium|high`, `?server=ws://host:port`.

Controls — desktop: right/left-click move (hold to steer), wheel zoom, arrows/screen-edge pan, Space recenter, Y camera lock, S stop.
Touch: tap to move, drag to pan, pinch to zoom.

## Quality

```bash
npm test               # unit tests (sim determinism, nav, map fairness, protocol, server room)
npm run typecheck
npm run bench          # server tick cost
node qa/smoke.mjs      # browser smoke test (needs dev client + server running and Playwright available)
```

## Docs

- `docs/design/TWIST_CONCEPTS.md` — the four core-mechanic candidates
- `docs/art/ART_BIBLE.md` — art bible
- `docs/tech/ARCHITECTURE.md` — architecture, netcode, rendering, budgets
- `docs/ROADMAP.md` — milestones
