# Project Lumen: Core Twist, Bulwarks

**Status:** Official game design document. Implements the locked "Bulwarks" spec.
**Owner:** Game Designer.
**Reads with:** `docs/art/ART_BIBLE.md` (Appendix A holds the visual notes), `docs/design/HEROES.md` (roster kits).
**Supersedes:** the open twist choice in `docs/design/TWIST_CONCEPTS.md`. Bulwarks is the stakeholder-selected twist and is not one of those four candidates.
**Convention:** plain numbers come from the locked spec. Numbers tagged **[P]** are proposed design values outside the spec, for prototyping, pending sign-off.

## 1. Vision and Player Fantasy

Each clan fortifies its half of the Skarnveld. Heroes are champions and engineers at once. You fight in the lane, and you also haul the timber and cut the stone that builds the lane's defences. A Hearthguard hero who sets a palisade across a ford and watches a wolf pack stall in a Rime Totem's frost is playing the same match as the one diving the enemy Skirmisher. There is no spectator phase.

Three pillars follow:

1. **Build under pressure.** Structures go up mid-fight, within reach of your hero and inside your half.
2. **Walls shape the fight.** Minions path through your maze, and the lane changes shape as the match goes on.
3. **Pressure is visible.** Every leak is counted on the Heartstone, so both teams always know how close the enemy is to the door.

## 2. Core Loop

**Minute to minute.** A hero cycles four actions: last-hit and collect bounties in lane, spend income on a structure within 14 m, send a unit with G when the bank allows, and fight the enemies who come to break the build. Upgrades and sells are a fifth action, taken in quiet moments.

**Match arc** (3v3 launch; times are targets):

- **Laning, 0:00 to 4:00.** 150 g start, first wave at 0:30. One Watch Tower or a Caltrops field at the lane mouth. Heroes learn the flow field by watching where minions walk.
- **Fortifying, 4:00 to 12:00.** Totems and catapults go up behind the first walls. First wolf packs and brutes leave the forts. Mazes grow through the lane's middle third.
- **Sending and siege, 12:00 to 20:00.** Heavy sends, wall-breaking, and the first gate tower falls. This opens the enemy Heartstone to hero damage.
- **Endgame, 20:00 onward.** Boss trolls and large leaks decide the match. The 40-structure team cap begins to bind.

## 3. Economy

### 3.1 Income sources

| Source | Amount | Trigger | Recipient |
|---|---|---|---|
| Start gold | 150 | Match start | Each hero |
| Passive | 1 g/s | Continuous | Each hero |
| Wave income | 40 + send bonus | Each wave start (every 30 s) | Each hero |
| Minion kill | 12 | Killing blow by a hero | Killer |
| Minion kill, structure-credited | 6 | Killed by a Bulwark or send unit | Split among heroes within 14 m |
| Wolf kill | 6 | Killing blow | Killer |
| Brute kill | 40 | Killing blow | Killer |
| Troll kill | 120 | Killing blow | Killer |
| Enemy hero kill | 200 | Killing blow | Killer |
| Enemy bulwark destroyed | 40% of total invested | Killing blow by a hero | Killer |
| Enemy gate tower destroyed | 150 | Destruction | Each hero on the team |

Two readings are adopted here. A bulwark kill pays the hero who lands the final blow. The gate tower payout goes to each hero, so one gate tower is worth 450 g to a 3v3 team and 750 g to a 5v5 team. Example: a fully upgraded Ember Catapult (410 g invested) pays its killer 164 g.

**Send bonus.** A send adds its bonus to its sender's wave income from the first wave after the unit joins. The bonus persists for the rest of the match. Wolf pack: +4 per wave (+8 g/min). Draugr Brute: +10 per wave (+20 g/min). Payback: the wolf pack's 60 g returns in 7.5 minutes, and the brute's 140 g in 7 minutes.

### 3.2 Example gold curve, minutes 0 to 15

Assumptions for one lane hero: passive 60 g/min; wave base 80 g/min; minion bounties averaging 30 g/min from 1:00 (about 2.5 kills at 12 g, plus splits); no hero or bulwark bounties; wolf pack sent at 4:00 and brute at 8:00. **G** is cumulative gross income. **S** is cumulative spend.

| Min | G (cum) | S (cum) | Bank | Purchases since previous row |
|---|---|---|---|---|
| 0 | 150 | 0 | 150 | None |
| 2 | 460 | 140 | 320 | Watch Tower (1:00), Caltrops (2:00) |
| 4 | 800 | 270 | 530 | Tower L2 (3:00), wolf pack (4:00) |
| 6 | 1,156 | 415 | 741 | Rime Totem (5:00), Palisade (6:00) |
| 8 | 1,512 | 635 | 877 | Totem L2 (7:00), brute (8:00) |
| 10 | 1,908 | 915 | 993 | Ember Catapult (9:00), Tower L3 (10:00) |
| 12 | 2,304 | 1,145 | 1,159 | Catapult L2 (11:00), Totem L3 (12:00) |
| 15 | 2,898 | 1,350 | 1,548 | Palisade L2 (13:00), Caltrops L2 (14:00), Catapult L3 (15:00) |

Reading the curve: of 2,898 g gross at minute 15, passive supplies 31%, wave base 41%, minion bounties 14%, send bonuses 8%, and the start 5%. Base income dominates, so last-hitting is worth less here than in a conventional MOBA (Section 13). The example banks heavily to show the pace. Efficient play should hold the bank under about 500 g.

## 4. Building Rules

**Input.** B opens the build bar with slots 1 to 5: Watch Tower, Rime Totem, Ember Catapult, Palisade, Caltrops. The ghost snaps to a 2 m grid under the reticle. LMB places. RMB or B cancels. Outside build mode, LMB is the basic attack.

A placement is valid only if every rule below passes.

| # | Rule | Test |
|---|---|---|
| P1 | Reach | Within 14 m of your hero |
| P2 | Own half | Distance to your Heartstone + 10 m is no more than distance to the enemy Heartstone |
| P3 | Forts | Footprint outside both forts' walls |
| P4 | Ground | Walkable; not water or cliff |
| P5 | Units | Footprint clear of all unit bodies |
| P6 | Cap | Team holds fewer than 40 structures; Caltrops count |
| P7 | Lanes | Server flood-fill: every lane spawn of both teams still reaches its Heartstone |
| P8 | Gold | Bank covers the cost |

A rejected ghost shows its reason in text: OUT OF REACH, OWN HALF ONLY, IN FORT, NOT WALKABLE, UNIT IN WAY, TEAM CAP, LANE BLOCKED, NO GOLD. LANE BLOCKED also outlines the cells that would seal the lane, since it is the rule players will hit most often.

**Upgrade and sell.** Look at an own structure within 8 m. U buys the next level (L1 to L2 to L3) at the listed cost. X sells for 70% of total gold invested in it. Upgrades keep the footprint, so they never re-run P7. [P] Upgrades do not restore HP, since the spec has no repair.

[P] Placement is instant. Build time is an open question (Section 13).

## 5. Bulwark Catalogue

| Structure | Build | L2 / L3 (cum.) | Attack | Range | HP | DPS (L1 / L2 / L3) |
|---|---|---|---|---|---|---|
| Watch Tower | 100 | +70 / +120 (290) | 34 / 52 / 78 per shot, every 0.8 / 0.8 / 0.7 s; single target | 13 / 14 / 15 m | 700 | 43 / 65 / 111 |
| Rime Totem | 120 | +80 / +130 (330) | Aura slows 30 / 40 / 50%; L3 adds chill of 12 dps | 7 m aura | 600 | 0 / 0 / 12 |
| Ember Catapult | 160 | +100 / +150 (410) | Splash radius 2.5 m, 55 / 85 / 125 every 2.2 s | 16 m (min 4 m) | 650 | 25 / 39 / 57 per target |
| Palisade | 25 | +25 / +40 (90) | None; solid for pathing | n/a | 500 / 800 / 1,200 | n/a |
| Caltrops | 40 | +30 / +50 (120) | 22 / 34 / 50 dps to each enemy standing on it | Footprint | Not attackable [P] | Per enemy |

**Gate tower (fixed).** One per lane per side, not buildable. Attacks as a Watch Tower L3. [P] HP 1,800, range 15 m.

**Targeting [P].** Towers and catapults prefer enemy heroes in range, then the nearest minion or send unit. Totems and Caltrops affect everything in their footprint.

**Roles and counterplay.**

- **Watch Tower** holds a lane. At L3 it is the strongest single-target hold in the game. Hilde (18 m) and Sigrun (24 m) outrange it. Minions chip it when they pass within 4 m.
- **Rime Totem** controls a zone rather than dealing damage. Its slow stacks with hero slows, capped at 60% total (ART_BIBLE 6.4). Brynna's Last Link and Hrodvar's Horn pull or push enemies out of its aura.
- **Ember Catapult** is area siege against clumped minions and wolves. Its 4 m minimum range means a hero inside it is safe from it. Pressure it at close range or outrange it.
- **Palisade** does not attack. It sets the path and absorbs damage. Gorrik's Gatebreak Slam and Doorfall are the natural counter, with Doorfall's 40% structure bonus.
- **Caltrops** is a floor trap that does not block. [P] Each field holds 10 charges. Each enemy-second of contact spends one charge, and the field expires after 60 s. A field softens late minions but cannot kill them (Section 13).

## 6. Pathing and Mazing

Each lane has a flow field to the enemy Heartstone. Cells inside the lane corridor cost 1, and off-lane cells cost 3. Palisades are solid. Caltrops and terrain are walkable. Minions always take the cheapest route.

The consequence is the core mazing rule: **minions leave the lane only when the lane route costs more than three times the open route through the forest.** The diagram below uses one 2 m cell per square. The lane is drawn 6 m wide for legibility. The maze route costs 40. A straight lane costs 34. The forest bypass along the top edge costs about 108, so minions detour only once the maze exceeds that.

```
legend: S spawn  H enemy Heartstone  # palisade  . lane  ~ off-lane forest (cost 3)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
........#...............#..........
S.......#.......#.......#.........H
................#..................
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

Minion rules:

- Minions attack heroes and minions in reach. They attack any structure within 4 m of their route. Otherwise they keep walking.
- Walls on the route boundary will be attacked. Build them at Palisade L2 or L3 HP (800 to 1,200), or place them 5 m or more from the route.
- Send units use the same flow field and attack rules.

## 7. Waves, Leaks and Bosses

Wave n starts at n × 30 s. Each side sends four minions per lane per wave. Scaling is linear, not compounding:

- HP multiplier = 1 + 0.08 × (n − 1)
- Damage multiplier = 1 + 0.05 × (n − 1)

[P] Base minion: 420 HP, 12 damage per hit.

| Wave | 1 | 10 | 20 | 30 |
|---|---|---|---|---|
| Minion HP | 420 | 722 | 1,058 | 1,394 |
| Minion damage | 12 | 17 | 23 | 29 |

**Rimetroll bosses** spawn on every fifth wave (waves 5, 10, 15 and so on). The reading adopted here is one per lane per side (Section 13). Base 1,800 HP, scaled by the same HP rule: 2,376 at wave 5, 3,096 at wave 10, and 4,536 at wave 20. [P] Speed is half a minion's.

**Leaks.** A hostile unit that reaches the Heartstone deals its leak damage and dies.

| Unit | Leak damage | Leaks to destroy a 4,200 HP Heartstone |
|---|---|---|
| Minion | 60 | 70 |
| Wolf | 25 | 168 |
| Brute | 200 | 21 |
| Rimetroll | 600 | 7 |

[P] Balance target: a balanced game loses no more than 25% of Heartstone HP (1,050) per 10 minutes. That is about 17 minion leaks across all lanes.

Heroes deal damage to the Heartstone only after one of its gate towers has fallen. Bulwarks and send units cannot damage it. They can only leak.

## 8. Sends

G opens the war table. Choose a lane. The unit joins your side's next wave on that lane.

| Send | Cost | Income bonus | Units | Leak if unopposed | Killer bounty | Share returned to enemy |
|---|---|---|---|---|---|---|
| Wolf pack | 60 | +4 per wave | 3 fast, fragile wolves | 75 | 6 each (18 total) | 30% |
| Draugr Brute | 140 | +10 per wave | 1 tanky brute | 200 | 40 | 29% |

[P] Wolf: 260 HP each, speed 1.6 times a minion. Brute: 1,100 HP, speed 0.8 times a minion. [P] One queued send per hero at a time.

A send is a gold transfer until it pays back. Enemy kills return 18 or 40 g to the killers. A brute sent into an enemy catapult is a double loss. Sends win when the lane is unguarded, and they are the comeback tool for a team that is behind (Section 11).

## 9. Hero Interaction

Heroes affect bulwarks three ways: they damage them, they displace them, and they build them. Shared rules [P]:

- Single-target damage to structures is at full value. Area damage (ground AoE, splash, damage over time) is 50%.
- Knockbacks, pulls and dashes stop at palisades. The target stops at the wall and takes no extra damage.
- Ground-level projectiles and skillshots are blocked by palisades. Arcing or aerial effects ignore walls.
- Heals never repair structures.

| Hero | Interaction with bulwarks |
|---|---|
| Gorrik | Wall-breaker. Doorfall's 40% structure bonus and Gatebreak Slam's knock-up make him the lane's door-opener. |
| Brynna | Hooked Reel (11 m) and Last Link (13 m) cannot pull through palisades. Pulling an enemy into a Totem aura or a Caltrops field is her strongest structure combo. |
| Hrodvar | Shield Rush stops at walls, so he needs a gap. His Horn slow stacks with the Totem cap. |
| Sigrun | Ice Lance (24 m) outranges every bulwark. Glacial Burst (20 m range, 0.9 s delay) is an area hit at 50% against structures. |
| Hilde | Split Shot is blocked by palisades. Winter Rain arcs over walls. A Cairn Snare root on a Caltrops field is a kill zone. |
| Ivar | Pine Stand is area, at 50% against structures. Grove Step roots stack with Caltrops. |
| Halla | Dawnfire Ring slows enemies 20% and heals allies. It does not repair walls. |
| Sanna | Shadow Cut and Hollow Mark stop at walls. Ash Veil's stealth makes a palisade corner an ambush point. |

## 10. Team Composition and Strategy

Three build archetypes. Each hero picks one per match, and teams mix them:

- **Economy.** Last-hit hard, bank, and buy few high-value structures (L3 totems and catapults). Safest with passive income. Weakness: an under-defended lane leaks early.
- **Fortress.** Palisade mazes with Caltrops and totems, and few sends. Keeps leaks near zero. Weakness: slow pressure, and walls must be rebuilt as they erode.
- **Sender.** Early wolf packs and brutes, compounding income and pressure on gate towers. Weakness: gold returns to killers, and the plan collapses in an unguarded lane.

Each team needs three roles covered: a wall-breaker such as Gorrik, a structure-outranger such as Hilde or Sigrun, and a sustain or slow such as Halla. Bots follow the same placement rules and gold. They build defences near their lane and send units, using the Economy and Fortress archetypes as defaults.

## 11. Win Conditions and Comebacks

**Win.** Destroy the enemy Heartstone (4,200 HP). Leaks and hero damage both count, and hero damage opens only after the first gate tower falls. [P] The launch build has no timer. A stalled match escalates: from minute 35, each wave adds one Rimetroll per lane.

**Comeback tools.** The spec already includes several:

1. **Base income floor.** Passive and wave base income ignore lane state, so a losing team keeps about 140 g per minute per hero.
2. **Bulwark bounty.** A trailing team that breaks a big investment is paid 40% of it.
3. **Gate tower payout.** One gate tower gives each hero 150 g, roughly a minute of base income.
4. **Cheap sends.** A wolf pack is a 60 g way for a trailing team to pressure a lane, and its bonus returns the gold in 7.5 minutes.
5. **Sell refund.** Selling returns 70%, so a losing team can move its bank to a new lane.

Leaks favour the defender only while the lane holds. One breached lane can be walled back, but a 4,200 HP door erodes with every leak.

## 12. UI and Controls

**Desktop**

| Action | Input |
|---|---|
| Open build bar | B |
| Select structure | 1 to 5 |
| Place / cancel | LMB / RMB or B |
| Upgrade / sell (structure within 8 m) | U / X |
| War table, choose lane | G, then 1 to 3 |
| Abilities and basic attack | Q, E, R, LMB outside build mode |
| Camera | Mouse look; scroll zooms; V toggles first person |

**Touch**

- A build button on the ability arc opens the bar. Slots are at least 52 dp. The ghost follows the screen-centre reticle, right-side drag re-aims, and Place and Cancel sit in the bar.
- Tap a structure within 8 m for a radial panel with Upgrade and Sell. The war table opens from the arc with three lane buttons.

**HUD.** The ghost's rejection reason is shown beside the ghost. The compass bar carries the wave timer and both Heartstone markers with their HP. Gold and income tick sit above the resource bars.

## 13. Tuning Risks and Open Questions

**Risks**

1. **Passive dominance.** Passive plus wave base is 72% of gross by minute 15. If last-hitting feels irrelevant, tune passive first.
2. **Uncapped send bonus.** Ten brutes sent means +100 g per wave for the rest of the match. [P] Cap send income at +40 per wave per hero.
3. **Gate payouts.** 450 g in 3v3 and 750 g in 5v5 for one tower is the strongest snowball in the spec.
4. **Early boss.** Wave 5 starts at 2:30, when a hero has about 400 g and the first troll has 2,376 HP. [P] Consider moving the first boss to wave 10 at 5:00.
5. **Boss leaks.** One troll per lane per side means three trolls leaking can remove 1,800 Heartstone HP, 43% of the total, from one wave.
6. **Team cap.** 40 is team-wide: 13 per hero in 3v3 but 8 per hero at 5v5. Decide whether the cap scales with team size.
7. **Caltrops late.** A wave-30 minion (1,394 HP) crossing an L3 field (50 dps, 10 charges) takes at most 500 damage before the field expires. Caltrops soften late waves but do not kill them.
8. **Projectile walls.** Palisades blocking ground projectiles may make heroes feel unable to fight through walls. Playtest against Hilde and Sigrun.

**Open questions**

- Build time: is placement instant, or does it take about 1 s?
- Do upgrades heal the structure to full?
- Does the enemy-bulwark bounty go only to the killing hero?
- Is the send bonus earned by the sender alone (the reading adopted here)?
- Is there a queue limit beyond the proposed one?
- Do wolves get a forest shortcut, given their speed?
- Is there one Rimetroll per lane per side, or one per lane in total?
- Is there any stall timer at all?
- L3 Catapult burning ground: [P] 15 dps for 4 s over a 2.5 m radius.

## 14. Telemetry

- **Placement:** structure type, level, minute and team. Every rejection, with its rule (P1 to P8).
- **Lanes:** lane-block rejections per lane; maze route length against the straight lane; count of minions stepping off-lane.
- **Leaks:** count and damage by unit type, lane and wave; Heartstone HP per minute.
- **Economy:** gross and spend per minute per hero; bank distribution; bounty sources.
- **Sends:** type, lane, kill rate and gold returned to killers.
- **Structures:** HP lost by type; killing blows by hero; time of the first gate tower.
- **Caltrops:** charges consumed and time to expiry.
- **Bosses:** time to kill a troll and where it died.
- **Refunds:** sell count and gold returned.

## 15. M1c resolutions (implemented)

Decisions taken while implementing the launch-slice heroes, items and the first telemetry-driven balance pass
(`npm run balance`; latest report in `docs/balance/REPORT.md`). Where they change numbers above, these win.

| Topic | Decision | Evidence / reason |
|---|---|---|
| Repair (§4, open question) | Added as a paid channel, not a heal: F on a friendly bulwark, 7% HP/s, full repair = 45% of invested gold. See `ITEMS.md` §3 | Fortress archetype had no answer to erosion besides sell-and-rebuild |
| Heals vs structures (§9) | Unchanged: heals never repair structures | — |
| Area damage vs structures (§9) | 50% (ground/self AoE, splash, burns) | As proposed |
| Projectiles vs palisades (§9, risk 8) | Enemy palisades absorb ground skillshots (they take the hit); hooks and ally threads stop on them; **own** palisades let your shots pass; arcing volleys (Winter Rain, catapults) ignore walls | Shooting over your own wall is the defender's advantage; the risk-8 worry is about attacking *into* a maze |
| Pulls and knockbacks (§9) | Stop at walls and palisades; Last Link's stun lands wherever the pull ends | As proposed |
| Send income (risk 2) | Capped at +40 per wave above base | As proposed |
| Early boss (risk 4) | First Rimetroll at wave 10 (5:00), then every 5th wave | Batch 2: matches ended by leaks alone at 4–7 min |
| Structure cap (risk 6) | 10 per hero and 40 per team | A human joining a bot-filled match found the team cap full and could not build |
| Stall (§11, "no timer") | **Rimetroll tide from 18:00**: every wave adds 1 troll per lane, +2 more every 3 minutes. Tide trolls march past enemy wave units (they fight only structures and heroes in their way) and pay no bounty or XP | Batch 1: 8/8 bot matches stalemated at 30 min (78 Heartstone HP leaked per match). Batches 4–5: the two mirrored tides met mid-lane and annihilated each other (~950 trolls killed after 18:00 in capped matches, zero leaks) while their bounties funded the defenders |
| Tower / Heartstone HP | Gate and outer towers 4,000 (was 2,600); Heartstone 5,000 (was 4,200) | Batch 2: first gate tower fell at 3.5–4 min, before the §2 "siege" phase |
| Assists | 50 g to each enemy hero who damaged the victim in the last 10 s | Supports and Vanguards had no gold from fights they won |
| Spawn | Heroes (re)spawn on the gate side of their Heartstone | Spawning behind it put the first build site ~25 m away |

Bot behaviour added for these systems: kit-aware casting, Mystic duo-laning with the ranged carry, item budget
(one item about every three minutes; bulwark spending leaves room for the next item), Hearth Recall to shop,
repairs when no enemy is near, no futile builds at the cap, and a team siege of the weakest enemy lane from minute 12
or once a gate tower has fallen. Bot decision randomness is seeded from the match seed: seeding it from bot ids alone
replayed identical per-side choices every match and showed up as a 35% Dawn win rate in mirrored-pair tests.
