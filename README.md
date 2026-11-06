# Project Lumen

Browser-first, server-authoritative **third-person action MOBA** set in **the Skarnveld** — a snow-ringed mountain
valley where two clans hold barrow-forts at opposite ends. Visual direction: **"Frost & Hearthfire"** — grounded,
atmospheric open-world-RPG realism (see `docs/art/ART_BIBLE.md`).

> Current stage: **M0 Foundation**. Core gameplay twist pending selection — see `docs/design/TWIST_CONCEPTS.md`.

## Run

```bash
npm install
npm run dev            # client on http://localhost:5173 (offline practice: sim runs in-page)
npm run dev:server     # authoritative server on ws://localhost:8787
# then open http://localhost:5173/?server=ws://localhost:8787  (open several tabs to see other players)
```

URL options: `?quality=low|medium|high`, `?server=ws://host:port`.

Controls — desktop: click to capture the mouse, WASD move, mouse look, LMB attack (hold to keep swinging), Q/E/R abilities (ground-targeted ones: hold to aim, release to cast), wheel zoom (all the way in = first person), V toggles 1st/3rd person, Esc releases.
Touch: left thumb = virtual stick, right thumb = look, attack/ability buttons on the right, VIEW toggles 1st/3rd person.

You play a 3v3 against bots offline; online, humans replace bots as they join. URL `?hero=hrodvar|sigrun` skips the picker.

Assets: CC0 textures/models/HDRI are committed under `packages/client/public/assets` (see `CREDITS.md` there).
Regenerate with `node tools/assets/fetch-assets.mjs [--force]`.

## Quality

```bash
npm test               # unit tests (sim determinism, nav, map fairness, protocol, server room)
npm run typecheck
npm run bench          # server tick cost
node qa/smoke.mjs      # browser smoke test (needs dev client + server running and Playwright available)
```

## Docs

- `docs/design/TWIST_CONCEPTS.md` — the four core-mechanic candidates
- `docs/design/HEROES.md` — 15-hero roster, launch slice, balance framework
- `docs/art/ART_BIBLE.md` — art bible
- `docs/tech/ARCHITECTURE.md` — architecture, netcode, rendering, budgets
- `docs/ROADMAP.md` — milestones
