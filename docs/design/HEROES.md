# Project Lumen: Hero Roster and Kit Design

**Status:** Draft 2 — launch slice implemented (M1c), see §7. Owner: Lead Gameplay/Character Designer.
**Reads with:** `docs/art/ART_BIBLE.md` (silhouettes, budgets, VFX), `docs/design/TWIST_CONCEPTS.md` (core twist, still pending).

Kit numbers here are design targets for prototyping, not final tuning. Where a hook depends on the pending twist, the hook is written so any of the four candidates can adopt it.

---

## 1. Design Pillars

1. **Readable from behind at 30 m.** Each hero has one silhouette signature (ART_BIBLE 7.2, R1). The signature drives the ability emblem, so players learn one shape per hero.
2. **Third-person aimed combat.** Every ability is aimed with the camera reticle. There is no click-to-target. Skillshots, cones, dashes, ground-targeted AoEs and self-AoEs cover the space. Ally-supporting effects are skillshots that attach to the first ally they hit.
3. **Four slots per kit.** Each hero has one basic attack plus Q, E and R (ultimate). Nothing else.
4. **Short, telegraphed crowd control.** Hard CC is brief (Section 5) and always shows a ground decal before it lands.
5. **Clan-agnostic.** No hero belongs to Dawn or Dusk. Team identity comes from rim and banner shape (ART_BIBLE R7), so any hero plays on either side.
6. **Twist-neutral kits.** Each hero carries a twist hook: a way its kit could adapt to the core twist without rewriting its numbers.

---

## 2. Roles

| Role | Job | Core stats feel | Heroes |
|---|---|---|---|
| **Vanguard** | Tank and initiator. Opens fights and holds the front. | Highest HP, mid damage, hard CC on entry | Gorrik, Brynna, Kettil |
| **Warden** | Bruiser. Trades blows in lanes and forts. | Durable, sustained melee damage | Hrodvar, Ragna, Ivar |
| **Skirmisher** | Melee assassin. Targets the weakest hero. | Low HP, highest burst, mobility | Sanna, Mattis |
| **Marksman** | Ranged physical. Holds distance and damages through the front. | Lowest HP among fighters, steady ranged DPS | Hilde, Yrsa, Fenna |
| **Runecaster** | Mage. Area control and burst from range. | Ability-heavy, long-range poke | Sigrun, Ashild |
| **Mystic** | Support and healer. Sustains allies and shapes fights. | Lowest damage, strong utility | Halla, Aud |

---

## 3. Roster

Fifteen heroes: 3 Vanguard, 3 Warden, 2 Skirmisher, 3 Marksman, 2 Runecaster, 2 Mystic. Two are already defined and are marked **Defined**. Thirteen are **Proposed**.

| # | Hero | Role | Silhouette signature (seen from behind) | Weapon | Difficulty | Status |
|---|---|---|---|---|---|---|
| 1 | Gorrik, Doorbreaker | Vanguard | Door-sized banded oak shield carried high | Oak tower shield, iron maul | 1 | Proposed |
| 2 | Brynna Chainhook | Vanguard | Iron chain trailing from wrist to weighted hook | Chain-hook | 2 | Implemented (M1c) |
| 3 | Kettil Hidebound | Vanguard | Ox-hide mantle beside a bronze-ringed spear planted upright | Bronze-ringed spear | 1 | Proposed |
| 4 | Hrodvar, the Antlered Warden | Warden | Antlered helm | Sword and kite shield | 1 | Implemented |
| 5 | Ragna Bonesplitter | Warden | Bone-hafted greataxe over one shoulder, grave-cloth ribbon | Greataxe | 2 | Proposed |
| 6 | Ivar Splitwood | Warden | Long ash spear with a bound pine sprig at the head | Ash spear | 2 | Proposed |
| 7 | Sanna Hollowstep | Skirmisher | Split cloak with three trailing ribbons, two knives crossed on the back | Twin curved knives | 3 | Proposed |
| 8 | Mattis Ashcloak | Skirmisher | Wolf-skull hood, hooked sickle hanging past the knee | Hooked sickle | 2 | Proposed |
| 9 | Hilde Longwatch | Marksman | Recurve longbow taller than she is | Longbow | 1 | Implemented (M1c) |
| 10 | Yrsa Quill-Brace | Marksman | Crossbow with a bone drum magazine above the stock | Repeating crossbow | 2 | Proposed |
| 11 | Fenna Stonesling | Marksman | Sling cord trailing behind like a tail | Sling | 2 | Proposed |
| 12 | Sigrun Frostcaller | Runecaster | Fur hood, rune staff topped by an ice crystal | Rune staff | 2 | Implemented |
| 13 | Ashild Emberscript | Runecaster | Tall staff with a brass brazier cup and a plume of flame; rune-chained book at the hip | Brazier staff | 2 | Proposed |
| 14 | Halla Lanternkeep | Mystic | Lantern staff with a glass-caged flame at its crown | Lantern staff | 2 | Implemented (M1c) |
| 15 | Aud Censer-Keeper | Mystic | Bronze censer swinging on a cord, leaving a smoke ribbon | Censer | 3 | Proposed |

**Difficulty scale.** 1: one ability needs aim, nothing else. 2: a combo or a conditional. 3: needs timing, positioning or pre-planned sequences.

---

## 4. Hero Kits

Ability notation: targeting type, range or radius, duration or delay, cooldown (CD).

### 4.1 Defined heroes

#### Hrodvar, the Antlered Warden
*Warden. Difficulty 1.*
- **Fantasy:** Hearth-sworn guardian who runs at the enemy line and makes the horn carry his people forward.
- **Silhouette:** Antlered helm, fur mantle and cape.
- **Weapon:** Sword and kite shield.
- **Basic:** Melee sword cleave, 2.8 m cone.
- **Q, Shield Rush:** Dash, 7 m. Damages and stuns (0.8 s) the first enemy hit.
- **E, Reaving Cleave:** Wide cone, 4 m. Damage and 30% slow for 1.5 s.
- **R, Horn of the Hearth:** Self-AoE, 7 m. Damages and slows enemies 40% for 2 s. Allies gain +30% move speed for 4 s.
- **Cooldowns (not in the defined spec, proposed):** Q 9 s, E 8 s, R 45 s, for implementation to confirm.
- **Twist hook:** Under Lanternfall, the Horn could leave a lingering light on the ground it sounds across. Under Tidefall, Shield Rush could end on a drifting bridge and be telegraphed by its dash line.

#### Sigrun Frostcaller
*Runecaster. Difficulty 2.*
- **Fantasy:** A fur-hooded frost mage who answers the cold with rune-carved ice.
- **Silhouette:** Fur hood and a rune staff topped by an ice crystal.
- **Weapon:** Rune staff with ice crystal.
- **Basic:** Frost bolt projectile, 16 m.
- **Q, Ice Lance:** Skillshot, 24 m. High damage and 35% slow. Long, piercing-free line.
- **E, Rime Step:** Blink-dash, 8 m.
- **R, Glacial Burst:** Ground-targeted AoE, 4.5 m radius, 20 m range. Detonates after 0.9 s. Damage and 1 s stun.
- **Cooldowns (not in the defined spec, proposed):** Q 8 s, E 10 s, R 45 s, for implementation to confirm.
- **Twist hook:** Glacial Burst could freeze a drifting island edge under Tidefall. Under Echoes, Rime Step could be replayed as a second blink.

### 4.2 Vanguard

#### Gorrik, Doorbreaker
*Vanguard. Difficulty 1.*
- **Fantasy:** The hall's gatekeeper, who treats enemy towers as doors that need knocking down.
- **Silhouette:** A door-sized banded oak shield carried high on the left arm, edge forward.
- **Weapon:** Oak tower shield and a short iron maul.
- **Basic:** Three-strike maul combo, 2.5 m melee. The third strike is a 3 m ground shock.
- **Q, Gatebreak Slam:** Ground-targeted, 7 m range, 3 m radius, 0.6 s delay. Damage and 0.5 s knock-up. CD 9 s.
- **E, Bracing Stance:** Self, 2.5 s. Takes 50% less frontal damage and cannot be displaced. CD 10 s.
- **R, Doorfall:** Skillshot, 14 m charge line, 2.5 m wide. Damage. First enemy hero is stunned 1.2 s. Deals 40% bonus damage to structures. CD 50 s.
- **Twist hook:** Under Lanternfall, Doorfall could leave a lit patch of ground where he ended. Under Tidefall, the charge line must read clearly across a moving bridge.

#### Brynna Chainhook
*Vanguard. Difficulty 2.*
- **Fantasy:** A ferry-crew hand who hauls the team across the river by nerve and iron.
- **Silhouette:** An iron chain dragging from her left wrist to a weighted hook, rattling behind her.
- **Weapon:** Weighted hook on a 6 m chain.
- **Basic:** Hook jab, 6 m reach. Every third hit reels the target 0.5 m.
- **Q, Hooked Reel:** Skillshot, 11 m line, 1 m wide. Pulls the first enemy hero 4 m toward her and slows them 25% for 1 s. CD 10 s.
- **E, Chain Whirl:** Self-AoE, 3.5 m. Damage and 3 m push outward. CD 8 s.
- **R, Last Link:** Skillshot, 13 m chain. Grapples the first enemy hero to her 6 m. Stuns on arrival for 1.0 s. All enemies within 3 m of the target slow 40% for 2 s. CD 45 s.
- **Twist hook:** Under Vessels, the chain could link two bodies so a swapped Vessel keeps the hook. Under Tidefall, the hook could snag a drifting island edge, making Last Link a map-shift tool.

#### Kettil Hidebound
*Vanguard. Difficulty 1.*
- **Fantasy:** A shieldwall captain who holds ground by standing where the line would break.
- **Silhouette:** A wide ox-hide mantle over a broad frame, with a bronze-ringed spear planted upright beside him like a standard.
- **Weapon:** Bronze-ringed spear, 2.2 m haft.
- **Basic:** Thrust, 3.2 m line. Every fourth thrust restores 2% max HP.
- **Q, Plant Standard:** Ground-targeted, 9 m range, 3 m radius. The spear stays planted 4 s. Allies inside take 15% less damage. CD 12 s.
- **E, Hide Bellow:** Self-AoE, 5 m. 30% slow for 1.5 s. CD 10 s.
- **R, Last Stand:** Self, 8 s. Kettil cannot move. He takes 50% less damage, and allies within 8 m regenerate 6% max HP per second. CD 40 s.
- **Twist hook:** Under Lanternfall, the planted standard could become a lantern that claims light. Under Echoes, an echoed standard could be replanted at the position it was in before. Under Tidefall, staking the standard could anchor a drifting island edge.

### 4.3 Warden

#### Ragna Bonesplitter
*Warden. Difficulty 2.*
- **Fantasy:** A grave-hunter who believes every wound should be paid back in kind.
- **Silhouette:** Bone-hafted greataxe over one shoulder, with a pale grave-cloth ribbon trailing from the haft.
- **Weapon:** Two-handed bone-hafted greataxe.
- **Basic:** Three-chop overhead sequence, 3 m melee cone. The third chop heals her 4% max HP.
- **Q, Bloodmark:** Skillshot, 8 m line, 1 m wide. The first enemy hit is marked 4 s. Her basic attacks on the marked target heal her for 8% of damage dealt. CD 8 s.
- **E, Gravewind:** Self-AoE, 3 m. Damage and an 8% max HP shield for 3 s. CD 9 s.
- **R, Wrath of the Split Oak:** Self, 8 s. Basic attacks cleave in a 2 m radius, deal +25% damage and heal 20% of damage dealt. CD 45 s.
- **Twist hook:** Under Echoes, a replayed swing could repeat the cleave a few seconds late. Under Vessels, the greataxe stays with whoever inhabits her body. Under Lanternfall, cleaves in darkness could reveal the enemies they touch.

#### Ivar Splitwood
*Warden. Difficulty 2.*
- **Fantasy:** A woodland warden from the pine groves who fights from the treeline and holds the road.
- **Silhouette:** Long ash spear with a bound pine sprig at the head; bark-banded forearms.
- **Weapon:** Ash spear, 2.6 m.
- **Basic:** Thrust, 3.0 m line. Every third thrust knocks the target back 1 m.
- **Q, Pinning Thrust:** Skillshot, 10 m line. Damages the first enemy hero and slows them 40% for 2 s. CD 9 s.
- **E, Grove Step:** Self-dash, 5 m backward. Leaves three root-roots (3 m radius) on the ground for 6 s. Enemies stepping in are rooted 0.8 s. CD 11 s.
- **R, Pine Stand:** Ground-targeted, 16 m range, 7 m radius, 8 s duration. Allied Wardens inside take 25% less damage. Enemies inside take 60 damage per second. CD 40 s.
- **Twist hook:** Under Tidefall, a Pine Stand could root onto a drifting island and move with the map. Under Lanternfall, the grove could cast shadow that hides its occupants. Under Vessels, the grove could hold a spirit that is between bodies.

### 4.4 Skirmisher

#### Sanna Hollowstep
*Skirmisher. Difficulty 3.*
- **Fantasy:** A knife-thin ambusher who learned to move in the dark between pine trunks.
- **Silhouette:** Split cloak with three trailing ribbons; two curved knives crossed on the back.
- **Weapon:** Twin curved knives.
- **Basic:** Three-hit flurry, 2.0 m melee. The third hit deals bonus damage to targets below 50% HP.
- **Q, Shadow Cut:** Dash, 6 m, along the reticle line to the first enemy hero. Damage. CD 7 s.
- **E, Ash Veil:** Ground-targeted, 9 m range, 4 m radius, 4 s. Enemies inside take 25% slower attack speed. Sanna gains stealth while standing in it. CD 11 s.
- **R, Hollow Mark:** Reticle lock on an enemy hero within 10 m. Dashes to them and strikes three times over 1.2 s. The last strike applies a mark. CD 40 s.
- **Twist hook:** Under Lanternfall, Ash Veil is the darkness that the mode is built around, making Sanna the team's signature ambusher. Under Echoes, Hollow Mark is the natural target for pre-meditated replays.

#### Mattis Ashcloak
*Skirmisher. Difficulty 2.*
- **Fantasy:** A pack hunter who follows a quarry until it bleeds out.
- **Silhouette:** Hunched figure with a wolf-skull hood; a hooked sickle hangs at his hip with the tip past the knee.
- **Weapon:** Hooked sickle on a short haft.
- **Basic:** Sickle slash, 2.2 m melee. Applies a 2 s bleed.
- **Q, Hamstring Hook:** Skillshot, 7 m line. Damage and 50% slow for 1.5 s. CD 8 s.
- **E, Pack Stalk:** Self, 4 s. +15% move speed. +20% damage against enemies below 50% HP. CD 12 s.
- **R, Quarry Mark:** Reticle lock on an enemy hero within 15 m, 6 s. The target is revealed through terrain and takes 25% more damage from all sources. CD 40 s.
- **Twist hook:** Under Vessels, Quarry Mark survives a body swap, so a spirit can keep chasing its target. Under Tidefall, the mark follows the target across shifting islands.

### 4.5 Marksman

#### Hilde Longwatch
*Marksman. Difficulty 1.*
- **Fantasy:** A patient ridge-watcher who wins fights before anyone closes the distance.
- **Silhouette:** Recurve longbow taller than she is, held low with the string drawn.
- **Weapon:** Recurve longbow.
- **Basic:** Arrow, 18 m projectile.
- **Q, Split Shot:** Skillshot, 18 m. The arrow splits into two at 12° after 8 m. Each half deals half damage. CD 7 s.
- **E, Cairn Snare:** Ground-targeted, 12 m range, 2 m trap. Arms after 0.5 s. Roots enemy heroes stepping in for 0.8 s. Lasts 45 s, max two traps. CD 12 s.
- **R, Winter Rain:** Ground-targeted, 22 m range, 9 m radius. After a 2.5 s delay, nine arrows fall over 2 s. Each arrow deals damage. Enemies inside are slowed 30% for 1.5 s. CD 50 s.
- **Twist hook:** Under Tidefall, Cairn Snares could follow a drift or sit on a bridge that is about to snap. Under Lanternfall, the arrows could carry light that reveals what they land near.

#### Yrsa Quill-Brace
*Marksman. Difficulty 2.*
- **Fantasy:** An armourer's daughter who built a crossbow that reloads itself from a bone drum.
- **Silhouette:** Crossbow with a bone drum magazine bolted above the stock.
- **Weapon:** Repeating crossbow.
- **Basic:** Bolt, 14 m projectile, one shot per click.
- **Q, Quill Storm:** Self, 3 s. Fires a bolt every 0.3 s at the nearest enemy in a 30° reticle cone, 14 m. CD 10 s.
- **E, Pin Bolt:** Skillshot, 13 m. Damage and 35% slow for 2 s. CD 9 s.
- **R, Bone Hail:** Ground-targeted, 16 m range, 8 m radius, 3 s duration. Deals damage every 0.5 s. Enemies inside are slowed 30%. CD 45 s.
- **Twist hook:** Under Vessels, the loaded drum could stay with the crossbow, so a spirit taking the weapon inherits its ammunition. Under Tidefall, Bone Hail could be placed over a shifting island edge.

#### Fenna Stonesling
*Marksman. Difficulty 2.*
- **Fantasy:** A river-bank slinger who can hit a marker stone on the far side of a ford.
- **Silhouette:** Sling with a long cord trailing behind like a tail; stone pouch at the hip.
- **Weapon:** Leather sling.
- **Basic:** Stone shot, 16 m projectile, fires every 0.5 s at half Yrsa's per-shot damage.
- **Q, Bounce Stone:** Skillshot, 14 m. Hits the first enemy and ricochets to a second enemy within 5 m for 60% damage. CD 7 s.
- **E, Stepping Stones:** Self-dash, 5 m backward. Drops three stone markers. Allies crossing them gain +20% move speed for 3 s. CD 10 s.
- **R, Skip-Stone Barrage:** Skillshot, 18 m. The stone skips along the ground three times. Each bounce damages enemies on its path. CD 42 s.
- **Twist hook:** Under Echoes, a replayed skip path could hit the same ground twice. Under Lanternfall, the stone markers could trace lit lanes across the valley.

### 4.6 Runecaster

#### Ashild Emberscript
*Runecaster. Difficulty 2.*
- **Fantasy:** A rune-scribe who keeps the hearth alive by writing the fire into stone.
- **Silhouette:** Tall staff with a brass brazier cup throwing a steady flame plume; rune-chained book at the hip.
- **Weapon:** Brazier-cup staff.
- **Basic:** Ember bolt, 14 m projectile. Applies a 1 s burn.
- **Q, Cinder Line:** Skillshot, 15 m line, 1.5 m wide. Damage and a 3 s burn. CD 8 s.
- **E, Ember Trail:** Self-dash, 5 m. Leaves a 6 m fire trail for 4 s. Enemies crossing it take damage and 15% slow. CD 11 s.
- **R, Hearth Eruption:** Ground-targeted, 14 m range, 6 m radius, 1.0 s delay. Damage and 0.5 s knock-up. CD 55 s.
- **Twist hook:** Under Lanternfall, fire becomes the mode's light territory, so Ember Trail could claim lanes. Under Tidefall, Ember Trail could melt ice and reshape a floe as it crosses. Under Echoes, a replayed trail could burn the same path twice.

### 4.7 Mystic

#### Halla Lanternkeep
*Mystic. Difficulty 2.*
- **Fantasy:** A camp-lantern keeper who walks the lanes at night, keeping allies in sight and in warmth.
- **Silhouette:** Lantern staff with a glass-caged flame at its crown.
- **Weapon:** Lantern staff.
- **Basic:** Light bolt, 12 m projectile. Light damage only.
- **Q, Lantern Beam:** Skillshot, 14 m line. Heals the first ally hit for a moderate amount and deals minor damage to the first enemy hit. CD 9 s.
- **E, Thread of Warmth:** Skillshot, 12 m. The first ally hit gains a shield of 10% max HP for 3 s. CD 9 s.
- **R, Dawnfire Ring:** Self-AoE, 8 m. Allies inside heal 25% max HP over 3 s. Enemies inside are slowed 20%. CD 50 s.
- **Twist hook:** Under Lanternfall, Halla is the light-bearer archetype, and Dawnfire Ring is a beacon. Under Echoes, her ring could be replayed as a second heal pulse. Under Vessels, the shield could carry across a swap.

#### Aud Censer-Keeper
*Mystic. Difficulty 3.*
- **Fantasy:** A censer-keeper whose smoke is both prayer and cover, and whose rite is the team's breath.
- **Silhouette:** Bronze censer swinging on a cord, leaving a trailing smoke ribbon.
- **Weapon:** Bronze censer on a 1.5 m cord.
- **Basic:** Censer swing, 2.4 m melee. Each hit leaves a smoke puff that heals the nearest ally 1% max HP.
- **Q, Sweet Smoke:** Ground-targeted, 9 m range, 6 m radius, 4 s. Allies inside regenerate 4% max HP per second. Enemies inside are slowed 20%. CD 10 s.
- **E, Blessing Cord:** Skillshot, 12 m. The first ally hit gains +15% move speed for 3 s and loses slows. CD 9 s.
- **R, Vigil Rite:** Self, 2 s channel. Allies within 14 m are immune to hard CC for 2 s and deal +25% damage for 4 s. CD 50 s.
- **Twist hook:** Under Tidefall, Sweet Smoke drifts with the wind and could be pushed across a map shift. Under Lanternfall, smoke blocks light and could hide allies in darkness. Under Echoes, a replayed cloud could recreate an earlier heal.

---

## 5. Launch Slice

**Recommendation:** Hrodvar, Sigrun, Hilde Longwatch, Brynna Chainhook and Halla Lanternkeep.

| Hero | Covers | Why it is in the slice |
|---|---|---|
| Hrodvar (Defined) | Warden, melee frontline | Already implemented. Dash, cone and self-AoE baseline. |
| Sigrun (Defined) | Runecaster, ranged burst | Already implemented. Skillshot, blink and ground detonation. |
| Hilde Longwatch | Marksman | Simplest kit (difficulty 1). Tests projectile splitting and placed traps. |
| Brynna Chainhook | Vanguard, initiator | Tests pull, grapple and reel. These are the riskiest CC systems in the slice. |
| Halla Lanternkeep | Mystic | Tests ally-attach skillshots and heals, and anchors the lantern prop used by the light twist. |

**Role coverage.** Every role except Skirmisher is represented. The skirmisher gap is intentional. Hrodvar's dash and Brynna's pull cover engage and dive, and Sanna is the first recommended addition for phase two.

**Mechanical variety.** The slice spans skillshots (Sigrun Q, Hilde Q, Halla Q), dashes (Hrodvar Q, Sigrun E), pulls and grapples (Brynna), placed traps (Hilde E), ground detonations (Sigrun R) and ally-attach heals (Halla Q and E). Those cover the aiming types the combat system must support.

**Asset reuse.** Vanguard and Warden shield rigs share bone and attachment names, so Brynna's shoulder and Hrodvar's shield arm reuse the same rig. Hilde's bow and Halla's staff share one staff armature. Sigrun's ice crystal reuses the frost shard VFX (ART_BIBLE 10), and Halla's lantern reuses the lantern prop built for the Lanternfall zones.

---

## 6. Balance Framework

These are baseline targets. Tuning happens against playtest data, not against these numbers.

### 6.1 Base stats
- **Base HP at level 1:** 520 to 800.
  - Vanguard: 720 to 800.
  - Warden: 640 to 700.
  - Skirmisher, Marksman, Runecaster: 520 to 580.
  - Mystic: 560 to 620.
- **HP growth per level:** Vanguard and Warden 60 to 80. All other roles 45 to 60.

### 6.2 Basic attack DPS bands
Measured at level 6, with no items, against an unarmored target.

| Role | Basic-attack DPS |
|---|---|
| Vanguard | 40 to 55 |
| Warden | 60 to 75 |
| Skirmisher | 75 to 95 |
| Marksman | 70 to 85 |
| Runecaster | 55 to 70 |
| Mystic | 30 to 45 |

### 6.3 Ability damage
- A Q or E cast should deal about 2.5 to 4 seconds of basic-attack DPS for its role.
- An R cast should deal about 6 to 9 seconds of basic-attack DPS, with area or duration as the extra value.
- Mystic heals follow the same scale, measured against allied max HP rather than DPS.

### 6.4 Crowd-control budget
- **Hard CC** (stun, root, knock-up, grapple-stun) is capped at **0.8 s** on Q and E and **1.5 s** on R.
- A hero may carry at most **two** hard-CC effects across the whole kit.
- **Slows** are capped at **50%** magnitude and about **2 s** typical duration. Stacked slows do not exceed **60%**.
- **Telegraph:** every hard CC shows a ground decal at least **0.3 s** before it lands (ART_BIBLE R5). Basic attacks are exempt.
- **Diminishing returns:** repeated hard CC on the same target within 6 s is applied at 100%, then 50%. After that the target is immune for 3 s.
- **Team budget:** no single hero should take more than **2.5 s** of hard CC in any 5 s window in a normal fight.

### 6.5 Cooldown bands
- **Basic abilities (Q and E):** 5 to 12 s. Mobility dashes sit at 6 to 9 s. Defensive shields and zones sit at 8 to 12 s.
- **Ultimates (R):** 35 to 60 s.
- Every hero in Section 4 satisfies these bands. Defined heroes use the proposed cooldowns in Section 4.1.

### 6.6 Difficulty and balance review
- Difficulty is reviewed after playtest, not fixed by the designer. A difficulty-3 hero whose kit gets 20% higher pick rates than the cohort goes back to review.
- Silhouette readability is checked at 30 m in grayscale (ART_BIBLE 15). Any hero that fails is changed before the kit is balanced.

---

## 7. Implementation (M1c)

The five launch-slice heroes are playable, bot-supported and tuned against headless telemetry
(`npm run balance`, report in `docs/balance/REPORT.md`). Numbers live in `packages/shared/src/heroes.ts`; where they
differ from §4 the reason is given here. Shipped numbers are level-1 base values (+per level).

| Hero | Shipped deviations from §4 | Why |
|---|---|---|
| Hrodvar | Cooldowns Q 9 s, E 7 s, R 45 s | §4.1 proposal, E one second shorter: his only non-dash damage tool between swings |
| Sigrun | Ice Lance 100 (+17), 7.5 s (proposal 8 s); Glacial Burst 45 s | 58–62% win rate and the best K/D in early batches at Q 6 s / R 40 s / 110 dmg |
| Hilde | HP 520 (+52); basic 43 (+6), 17 m (spec 18), 1.08 s; Split Shot 90 (+15), 8 s (spec 7); Winter Rain 7 m radius (spec 9), 1.6 s lead (spec 2.5), nine volleys of 36 (+6) | Above 55% in every batch until the final pass (52–56% after it). A 9 m, nine-volley zone was inescapable for melee heroes; the shorter lead keeps it a reaction test without the telegraph overstaying |
| Brynna | HP 790 (+84); basic reach 5.5 m (spec 6), reel 0.8 m (spec 0.5) every third landed jab; Chain Whirl 95 (+15); Last Link 40 s (spec 45) and pulls the target **all the way to her** (up to 13 m), stunning on arrival | "Grapples to her" read better than a fixed 6 m drag. The stun lands on arrival, not on hit, so a wall that stops the pull still stuns where the target ends up. Survivability raised after 39–43% batches |
| Halla | HP 610 (+58); basic 38; Lantern Beam heals 180 (+25), burns 60 (+9), 7 s (spec 9); Thread shield 90 (+14) + 12% max HP (spec 10%), 8 s (spec 9); Dawnfire 30% over 3 s (spec 25%), 45 s (spec 50) | Lowest or near-lowest in every batch (33–45%); bots under-play supports, so she was tuned up in small steps rather than to bot parity |

See `docs/balance/HISTORY.md` for the batch-by-batch evidence.

Rules adopted from TWIST_BULWARKS §9 and §6.4:

- Hooks (`heroOnly`) pass through minions and are stopped by enemy palisades. Ally threads pass through enemies.
- Hard CC on heroes has diminishing returns: 100%, 50%, then 3 s immunity within 6 s ("Immune" floats over the target).
- Bosses (Rimetrolls) take half-duration stuns and cannot be displaced.
- Area damage against structures is 50%.

Readability: Hilde carries a recurve longbow taller than her (its string draws back on the shot) and a pointed cowl;
Brynna an open spangenhelm, chain coiled on the forearm and a weighted hook; Halla a wool hood and an upright lantern
staff with a flickering caged flame. The chain is drawn as real links from Brynna's hand to the hook, then to the
victim during the reel.
