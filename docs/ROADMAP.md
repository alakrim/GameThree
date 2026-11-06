# Roadmap

| Milestone | Scope | Status |
|---|---|---|
| **M0 Foundation** | Monorepo, deterministic sim, nav, authoritative server, client renderer + art direction, input (mouse/touch), interpolation, tests, smoke QA | ✅ Done |
| **M0.5 Direction change** | Third-person/first-person action-MOBA camera, WASD + mouse-look + touch stick, client prediction/reconciliation, PBR "Frost & Hearthfire" world (HDRI sky, splatted terrain, pine forest, forts), CC0 asset pipeline with LODs | ✅ Done |
| **M1a Combat core** | Data-driven abilities (dash/cone/projectile/ground AoE/self AoE), stun/slow/haste, towers + Heartstone + win/reset, fighting minions, XP/levels/respawn, 3v3 bots, Hrodvar + Sigrun, attack/cast/death animations, VFX, procedural SFX, ability HUD, hero picker | ✅ Done (twist-independent) |
| **Twist selection** | Chosen: **MOBA + tower defence ("Bulwarks")** — `docs/design/TWIST_BULWARKS.md` | ✅ Decided |
| **M1b Bulwarks** | Gold economy, 5 buildable structures × 3 levels, mazing flow fields with anti-seal rule, leaks, scaling waves + Rimetroll bosses, sends (wolves, brutes) + income, bots that build/send, build ghost/upgrade/sell/war table UI | ✅ Done |
| **M1c Slice content** | Hilde, Brynna, Halla (traps, split shots, volleys, hooks/pulls/pushes, heals, shields, HoTs); status system with CC diminishing returns; hero ↔ structure rules (50% area damage, palisades stop skillshots/pulls, paid repair); items v0 (9 items, fort shop); Hearth Recall; kill credit + assists; match telemetry + parallel headless balance runner (mirrored-pair matches); 10 telemetry batches (≈ 330 bot matches) / 4 tuning passes (`docs/balance/HISTORY.md`); kit-aware bots that shop, recall, repair and siege; HUD: shop, item slots, status chips, shield bar, team frames, kill feed, scoreboard, channel bar, five-hero picker; camera shake | ✅ Done |
| **M2 Vertical slice** | 5 polished heroes with final **skinned** models (replacing the articulated stand-ins), animations/VFX/SFX, full 5v5 match vs bots, match flow (draft → load → match → results with the telemetry summary), audio mix, UI pass | Next |
| **M3 Netcode hardening** | Prediction/reconciliation, binary deltas, fog culling, lobby + matchmaking, reconnect, replays, load tests | |
| **M4 Launch roster** | 15+ heroes, balance tooling, telemetry, progression | |
| **M5 Mobile** | Capacitor packaging, mobile HUD layout (virtual stick + ability medallions), thermal/perf tuning | |
