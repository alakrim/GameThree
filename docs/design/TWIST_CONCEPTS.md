# Core Twist — Four Candidate Concepts

**Status: AWAITING DIRECTOR/STAKEHOLDER SELECTION.** Core gameplay implementation is paused on this decision.
Everything built so far (deterministic sim, netcode skeleton, renderer, art direction) is twist-agnostic.

> **Update (direction change):** the game is now a third-person / first-person **action MOBA** with grounded
> open-world-RPG visuals. All four concepts carry over; notes on how each plays from behind the shoulder are in the
> section at the end.

Each concept changes a different axis of the MOBA formula: **time**, **space**, **identity**, and **information**.

---

## 1. ECHOES — "Your past self is your teammate"

**Pitch.** Every hero is constantly recorded by the server (last ~6 s of movement and casts). At key moments you can
*release your Echo*: a glass-lacquer ghost that re-performs exactly what you did, from where you did it, at reduced power
(~40% damage, no healing), while you keep playing in the present.

**How it changes the formula.** A MOBA fight becomes a fight across two timelines. Skill expression shifts from
reaction speed to *pre-meditation*: you "write" a combo now so you can play it back later as a second threat.
- Each hero has 3 abilities + ultimate; the Echo is a universal 4th action on a long cooldown, fuelled by "Chrona" earned
  from last-hits and takedowns.
- **Chronoliths** (map objectives) grant the capturing team one *Team Rewind*: all allied heroes snap back to their
  positions/HP of 4 s ago — the ultimate teamfight reset.

**Combat / strategy / objectives / comp.**
- Combat: bait-and-replay plays, double-casting skillshots, using your Echo to body-block or fake a retreat path.
- Strategy: lane trades are planned around your Echo timer; enemy Echo cooldowns become tracked information.
- Objectives: Chronoliths sit in the river and dictate fight timing like dragons, but their reward is tactical, not stats.
- Comp: heroes have an *Echo affinity* (e.g. a sniper whose echo also snipes = huge value), and a counter class,
  *Severers*, who can shatter Echoes or reflect them.

**Why players love it.** Every fight produces "how did that happen?" highlight-reel moments; deep mind games;
nobody else is doing it.

**Technical complexity & risks — HIGH.**
- Fits our architecture well: the sim is already deterministic and command-based, so recording/replaying a hero's
  command stream is natural on the server. Replays come almost free.
- Risks: readability (two copies of every hero in teamfights — must solve with strong visual language), balance of
  "double damage" windows, cognitive load on mobile, harder bot AI. Biggest design risk of the four.

---

## 2. TIDEFALL — "The map is the objective"

**Pitch.** The Shoals of Aurel are floating islands. Every ~4 minutes the **Tide** turns: islands drift, bridges form or
snap, lanes reroute, and jungle groves re-dock next to a different base. Teams fight over **Anchor Stones** that decide
*which* configuration the next Tide locks in.

**How it changes the formula.** The static three-lane map — the one constant of every MOBA — becomes the main contested
resource. Macro play is literally terraforming: pull the enemy's jungle island into your territory, bring a bridge
right up to their tower, or isolate a split-pusher.
- ~8 authored map states (not procedural) keep it learnable and balanceable; the Tide moves between them with a
  20-second telegraphed drift.
- Island edges are real: knockbacks off the edge send heroes into the cloud sea ("Lost in Cloud": short respawn
  + gold loss, not instant death).

**Combat / strategy / objectives / comp.**
- Combat: terrain-aware positioning, ring-outs, fights on moving bridges.
- Strategy: draft and macro around which map states favour your comp; comeback potential through map control.
- Objectives: Anchor Stones (3 per Tide cycle) plus a late-game "Maelstrom" state that merges both bases' islands.
- Comp: displacement (knockback/pull) heroes gain value; "Wayfinders" can create temporary bridges.

**Why players love it.** No two matches flow the same; huge spectacle moments; very streamable.

**Technical complexity & risks — MEDIUM-HIGH.**
- Navigation must re-bake per island chunk deterministically (our grid nav supports region rebuilds; chunked by island).
- Level design is the cost: 8 balanced states × 3 transitions. Art/animation cost for drifting islands is moderate.
- Risk that the map changes feel random/unfair if telegraphing is weak; ring-outs must be tuned to avoid frustration.

---

## 3. VESSELS — "Heroes are bodies; you are the spirit"

**Pitch.** Each player is a *Lumen spirit* who drafts **two Vessels** (heroes). Only one is inhabited at a time; the other
waits in the team Reliquary. At shrines across the map you can swap Vessels mid-match. When your Vessel dies, your spirit
survives for a few seconds and can flee to a shrine, possess a neutral jungle titan, or claim the fresh body of an enemy
you just killed.

**How it changes the formula.** Team composition stops being fixed at draft. Death is no longer 40 seconds of staring at a
grey screen — the spirit phase is gameplay. Counter-picking happens *during* the match.

**Combat / strategy / objectives / comp.**
- Combat: "body-steal" turns won fights into extra power; spirits can scout but are fragile.
- Strategy: Vessel pairing (e.g., a lane-bully + a late-game carry) and when to swap is a core macro decision.
- Objectives: Shrines become contested map control points; jungle titans become possessable siege units.
- Comp: 10 Vessels per team instead of 5 — drafts get very deep; items attach to the spirit, levels to the Vessel.

**Why players love it.** Almost no downtime, more heroes played per match, clutch "steal their carry" moments.

**Technical complexity & risks — HIGH (design), MEDIUM (tech).**
- Tech is straightforward entity-ownership transfer (already modelled as `owner` on entities).
- Design risk is large: balancing two-hero drafts, snowballing from body-steals, players must know many heroes,
  identity clarity (whose spirit is in which body). Requires a roster closer to 20+ to feel deep, pressuring the launch scope.

---

## 4. LANTERNFALL — "Light is territory, vision and mana"

**Pitch.** The Shoals live under a permanent eclipse. **Light** is everything: it reveals, it heals, it powers abilities.
Each team paints the battlefield with its light — minion waves carry lanterns that light the lane behind them, heroes
emit a personal light radius, and abilities leave lingering light (or darkness) on the ground.

**How it changes the formula.** Fog of war — normally a static, ward-placing chore — becomes the core, dynamic, painted
territory system.
- Standing in *your* light: regenerate Lumen (ability resource), see everything in it.
- Standing in *enemy* light: you are revealed to them and drain slowly.
- In *darkness*: everyone is hidden, Gloom creatures roam, and ambushes rule.
- Lumen is harvested from the glowing cloud-river and from kills, then spent on abilities — so territory = mana economy.

**Combat / strategy / objectives / comp.**
- Combat: fights are won by whoever controls the lighting of the arena; flares, eclipses and light-snuffing are
  ability verbs.
- Strategy: pushing a lane literally lights the map toward the enemy; giving up territory is visible and readable.
- Objectives: **Beacons** permanently light a region for the owner; the late-game **Sunrise** objective lights the whole
  map in your colour for 60 seconds (the "Baron" moment).
- Comp: *Lightbearers* (expand/sustain), *Shades* (stealth assassins who thrive in darkness), *Snuffers* (convert enemy
  light to darkness), *Wardens* (anchor beacons). Every hero is defined by how it interacts with light.

**Why players love it.** Tense ambushes, readable territory at a glance, a vision game that is *fun* instead of chore-like,
and a stunning look: it is our "Lacquer & Light" art pillar made literal.

**Technical complexity & risks — MEDIUM.**
- Server-side per-player visibility is required anyway for anti-cheat fog culling; here it becomes the core mechanic.
- Light field: a low-res (e.g. 160×160) team-ownership grid in the deterministic sim; rendered client-side as a
  texture sampled by the ground/toon shader — cheap even on low-tier phones.
- Risks: darkness must stay readable (silhouette rim-light, never pitch black); balance of stealth vs counterplay;
  ensuring light painting feels like strategy rather than busywork.

---

## Director's recommendation

| | Echoes | Tidefall | Vessels | Lanternfall |
|---|---|---|---|---|
| Novelty | ★★★★★ | ★★★★ | ★★★★ | ★★★★ |
| Strategic depth | ★★★★ | ★★★★ | ★★★★★ | ★★★★★ |
| Readability / mobile fit | ★★ | ★★★ | ★★★ | ★★★★ |
| Fit with art direction | ★★★ | ★★★★ | ★★★ | ★★★★★ |
| Production risk (more ★ = safer) | ★★ | ★★★ | ★★ | ★★★★ |

**Recommended: Lanternfall.** It turns the system every MOBA already has (fog of war) into the defining mechanic,
touches every layer (economy, vision, objectives, hero identity), fits phones, and fits the visual identity.
**Echoes** is the boldest pick if we want the most distinctive hook and accept higher readability risk.

---

## How each concept plays in third person

- **Echoes:** stronger in third person — seeing your own ghost run past your shoulder and re-swing your sword is
  visceral. Readability risk is lower than top-down because there are fewer units on screen at once.
- **Tidefall:** islands become drifting rock shelves and ice floes on the glacial river; ring-outs into a chasm are very
  physical from eye level. Spectacle is excellent; telegraphing map shifts needs strong audio/horizon cues.
- **Vessels:** body-swapping in third person is a dramatic camera moment (spirit flies to the new body). The fixed
  over-the-shoulder view makes "who am I now?" clear.
- **Lanternfall:** the best fit for the new look. A torch-lit northern night where you literally cannot see past your
  light radius; ambushes from the dark pine forest; carrying light down a road at eye level. It also gives the
  "Frost & Hearthfire" art pillar its gameplay meaning.

The recommendation is unchanged — **Lanternfall** — and has become stronger with the camera change.
