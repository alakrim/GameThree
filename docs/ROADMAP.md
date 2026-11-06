# Roadmap

| Milestone | Scope | Status |
|---|---|---|
| **M0 Foundation** | Monorepo, deterministic sim, nav, authoritative server, client renderer + art direction, input (mouse/touch), interpolation, tests, smoke QA | ✅ Done |
| **M0.5 Direction change** | Third-person/first-person action-MOBA camera, WASD + mouse-look + touch stick, client prediction/reconciliation, PBR "Frost & Hearthfire" world (HDRI sky, splatted terrain, pine forest, forts), CC0 asset pipeline with LODs | ✅ Done |
| **M1a Combat core** | Data-driven abilities (dash/cone/projectile/ground AoE/self AoE), stun/slow/haste, towers + Heartstone + win/reset, fighting minions, XP/levels/respawn, 3v3 bots, Hrodvar + Sigrun, attack/cast/death animations, VFX, procedural SFX, ability HUD, hero picker | ✅ Done (twist-independent) |
| **Twist selection** | Chosen: **MOBA + tower defence ("Bulwarks")** — `docs/design/TWIST_BULWARKS.md` | ✅ Decided |
| **M1b Bulwarks** | Gold economy, 5 buildable structures × 3 levels, mazing flow fields with anti-seal rule, leaks, scaling waves + Rimetroll bosses, sends (wolves, brutes) + income, bots that build/send, build ghost/upgrade/sell/war table UI | ✅ Done |
| **M1c Slice content** | 3 more heroes from the launch slice in `docs/design/HEROES.md`, hero interaction with structures (repair, siege abilities), items v0, balance pass with telemetry | Next |
| **M2 Vertical slice** | 5 polished heroes with final **skinned** models (replacing the articulated stand-ins), animations/VFX/SFX, full 5v5 match vs bots, match flow (draft → load → match → results), audio mix, UI pass | |
| **M3 Netcode hardening** | Prediction/reconciliation, binary deltas, fog culling, lobby + matchmaking, reconnect, replays, load tests | |
| **M4 Launch roster** | 15+ heroes, balance tooling, telemetry, progression | |
| **M5 Mobile** | Capacitor packaging, mobile HUD layout (virtual stick + ability medallions), thermal/perf tuning | |
