# Balance history (M1c)

Each batch is `npm run balance` — headless 3v3 bot matches with random rosters on 4 threads. The latest full
report is `REPORT.md` (raw per-match data in `REPORT.json`). Win rates are over decided matches; with ~30 decided
picks per hero one standard error is ≈ 9 points, so only differences that persist across batches are acted on.

| Batch | Matches (cap) | Decided | Avg length | First gate tower | Hrodvar | Sigrun | Hilde | Brynna | Halla | What it showed → what changed |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 8 (30 min) | 0 | 30.0 | 6.3* | – | – | – | – | – | Every match stalled: 40-structure team caps filled, waves leaked 78 HP/match, bots never pushed a Heartstone; 7,695 refused builds at the cap; Halla alone in a lane healed 81 HP/min. → Rimetroll tide, per-team cap scaled by heroes, Mystic duo-lanes, bot siege mode, no futile builds |
| 1b | 8 (30) | 6 | 15.2 | 8.9 | 75% | 56% | 50% | 40% | 40% | Matches end; tiny sample. → full 40-match batches from here |
| 2 | 40 (30) | 35 | 14.9 | 6.7 | 51% | 58% | 61% | 48% | 33% | Gate towers fell as early as 3.5 min; early trolls (wave 5) ended games by leaks alone at 4–7 min. → towers 4,000 HP, Heartstone 5,000, first troll at wave 10; Hilde −dmg, Sigrun +cooldowns, Halla +HP/heal/shield |
| 3 | 40 (35) | 31 | 21.5 | 9.0 | 47% | 51% | 58% | 52% | 43% | Length on target, 9 matches still stalled. → tide from 18:00 and steeper; Hilde Split Shot 8 s and 17 m range; Halla +heal, shield 12% |
| 4 | 40 (35) | 25 | 23.3 | 8.3 | 47% | 62% | 73% | 39% | 33% | More stalls (15). Tide trolls paid 120 g bounties to defenders: income 10.6k/hero/match. → tide pays no bounty/XP; Hilde, Sigrun −dmg; Brynna +HP/Whirl; Halla −cooldowns |
| 5 | 40 (35) | 24 | 23.0 | 8.9 | 54% | 56% | 58% | 50% | 35% | Four heroes within 1 SE of 50%. Still 16 stalls: ~950 trolls died after 18:00 in capped games with **zero leaks** — the two mirrored tides met mid-lane and annihilated each other. → tide trolls march past wave units; in 3v3 supports hold their own lane (a hero-less lane bleeds); Dawnfire 30% |
| 6 | 40 (35) | **40** | 22.0 | 10.9 | 51% | 52% | 64% | 43% | 40% | No stalls; lengths 11–31 min; gate towers fall in the §2 siege window. Hilde high in every batch. → Hilde 520 HP, slower basic; Brynna +HP/level, Last Link 40 s; Halla +heal |
| 7 | 40 (35) | **40** | 25.6 | 12.2 | 43% | 57% | 54% | 54% | 43% | All five heroes within ~1 SE of 50%. Dawn won only 30% (other batches: 45–58%) with picks split evenly by side — but the runner replayed identical side/roster pairings every batch, so side bias and roster strength were confounded. → runner now plays **mirrored pairs** (same seed and line-ups, sides swapped) |

\* Batch 1 counted any tower as the "first gate tower"; fixed from batch 1b on (gate = tier-2 tower).

Persistent caveat: bots aim at a target's current position and kite well with ranged kits, so Marksman and
Runecaster results are flattered relative to human play, and supports are under-played. Human playtest data should
overrule these numbers wherever they disagree.
