# Project Lumen

Browser-first, server-authoritative **third-person action MOBA** set in **the Skarnveld** — a snow-ringed mountain
valley where two clans hold barrow-forts at opposite ends. Visual direction: **"Frost & Hearthfire"** — grounded,
atmospheric open-world-RPG realism (see `docs/art/ART_BIBLE.md`).

> Core twist: **MOBA + tower defence ("Bulwarks")** — heroes fight in the lanes *and* fortify them: build and upgrade
> towers, totems, catapults, palisades and traps, maze the enemy's waves, and send wolves and brutes into theirs.
> See `docs/design/TWIST_BULWARKS.md`.

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

Bulwarks: B (or 1–5) opens the build bar, LMB places the ghost (green = valid), RMB/B cancels; look at your structure and press U to upgrade, X to sell, F to repair (for gold); G opens the war table to send units. Touch: BUILD / SEND / PLACE / REPAIR buttons.

Gear and tempo: P opens the quartermaster (items trade inside your fort or while dead), H channels Hearth Recall home (4 s), hold Tab for the scoreboard. Touch: SHOP / HOME.

Heroes: **Hrodvar** (Warden), **Sigrun** (Runecaster), **Hilde** (Marksman — split arrows, snares, arrow rain),
**Brynna** (Vanguard — chain hook, whirl, grapple) and **Halla** (Mystic — healing beam, ward thread, dawnfire ring).
You play a 3v3 against bots offline; online, humans replace bots as they join. URL `?hero=hrodvar|sigrun|hilde|brynna|halla` skips the picker.

Assets: CC0 textures/models/HDRI are committed under `packages/client/public/assets` (see `CREDITS.md` there).
Regenerate with `node tools/assets/fetch-assets.mjs [--force]`.

## Quality

```bash
npm test               # unit tests (sim determinism, nav, map fairness, protocol, server room)
npm run typecheck
npm run bench          # server tick cost
npm run balance        # headless bot matches on all cores → docs/balance/REPORT.md (args: [matches] [out.md] [capMinutes])
node qa/smoke.mjs      # browser smoke test (needs dev client + server running and Playwright available)
```

## Docs

- `docs/design/TWIST_BULWARKS.md` — the core twist (MOBA + tower defence)
- `docs/design/TWIST_CONCEPTS.md` — the original four core-mechanic candidates
- `docs/design/HEROES.md` — 15-hero roster, launch slice, balance framework, M1c implementation notes
- `docs/design/ITEMS.md` — items v0, repair, Hearth Recall
- `docs/balance/REPORT.md` — latest telemetry-driven balance report
- `docs/art/ART_BIBLE.md` — art bible
- `docs/tech/ARCHITECTURE.md` — architecture, netcode, rendering, budgets
- `docs/ROADMAP.md` — milestones
