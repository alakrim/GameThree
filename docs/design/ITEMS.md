# Project Lumen: Items v0, Repair and Hearth Recall

**Status:** Implemented in M1c. Owner: Gameplay. Data: `packages/shared/src/items.ts`.
**Reads with:** `TWIST_BULWARKS.md` (economy, §3), `HEROES.md` (balance framework, §6).

## 1. Why items exist in a Bulwarks match

Gold already buys structures, upgrades and sends. Items add a fourth sink with a different answer: a stronger *hero*
instead of a stronger *lane*. That tension is the design. A hero who buys a Troll-Bone Plate is a palisade, a Rime Totem
upgrade and two wolf packs poorer. Every purchase should feel like a choice, not a ladder.

Rules:

1. **Four slots, passive only.** No actives in v0, so there are no new buttons and nothing to learn mid-fight.
2. **Bought at your fort.** Trade only inside your fort walls or while dead. You can browse anywhere (P), but buying means going home. Hearth Recall (H) makes that trip a 4 s decision, not a 20 s walk.
3. **One of each.** Duplicates are refused, so a build is four distinct choices.
4. **Sell for 60%.** Less than the 70% bulwark refund: changing your mind about a hero costs more than moving a wall.
5. **Small, legible numbers.** Every item is one or two stats. Caps: armor 35%, cooldown reduction 35%, move speed +20%.

## 2. Catalogue

| Item | Cost | Stats | Who wants it |
|---|---|---|---|
| Iron-Shod Boots | 220 | +9% move speed | Everyone, eventually; the lane-swap and rotation item |
| Wolfhide Mantle | 280 | +220 max HP | Frontliners; Mystics who get dived |
| Whetstone Edge | 300 | +14 attack damage | Marksmen; basic-attack Wardens |
| Rune of Swiftcasting | 360 | −15% ability cooldowns, +8% ability power (damage, heals, shields) | Runecasters and Mystics |
| Draugr-Fang Amulet | 330 | +6 attack damage; basic attacks heal 15% of damage dealt | Wardens and Marksmen who trade long |
| Hearth Ember | 250 | +80 max HP; out of combat (4 s), regenerate 1.5% max HP/s | Lane sustain without going home |
| Sapper's Ram-Head | 290 | +6 attack damage; +40% damage to towers, bulwarks and Heartstones | The wall-breaker slot (TWIST_BULWARKS §10) |
| Troll-Bone Plate | 420 | +120 max HP; take 12% less damage | Late frontline |
| Mason's Kit | 170 | +60 max HP; repair 60% faster and 40% cheaper | Fortress builders (§10 archetype) |

Bot builds by role (also a sensible starting point for players):
Warden: Boots → Mantle → Fang → Plate. Vanguard: Mantle → Boots → Plate → Ram-Head. Marksman: Edge → Boots → Fang →
Ram-Head. Runecaster: Rune → Boots → Ember → Mantle. Mystic: Rune → Mason's Kit → Boots → Ember.

## 3. Repair

TWIST_BULWARKS left repair out ("Upgrades do not restore HP, since the spec has no repair"), which left the Fortress
archetype (§10) only one answer to an eroding wall: sell at a damaged-HP refund and rebuild. Repair keeps the rule that
**heals never repair structures** and adds a separate, paid action:

- **F** while looking at a friendly bulwark within 4.5 m (touch: REPAIR). The hero channels in place, hammering.
- Restores 7% of max HP per second. A full repair costs **45% of the gold invested** in the structure, charged as HP
  is restored (so topping up a scratch is cheap). Mason's Kit: 60% faster and 40% cheaper.
- Not on Caltrops (they are consumed by use) or gate towers (fixed map objectives).
- Broken by moving, acting, being stunned or displaced, and by damage from heroes or towers. Minion hits do not break
  it: repairing under a wave is the fantasy; repairing under a hero is a mistake.

## 4. Hearth Recall

- **H** (touch: HOME): channel 4 s, then return to your spawn slot inside the fort. A column of hearth-light marks the
  channel for everyone, so recalling in sight of an enemy is a risk.
- Moving, acting, stuns, displacement or **any** damage cancels it.
- Unavailable inside your own fort (you are already home).

## 5. Telemetry hooks

Spend per category (`item`, `repair`) is recorded per hero; items owned at match end are in the summary. The balance
report lists both. Watch for: one item owned by >80% of heroes (a must-buy — tune down), an item nobody buys, repair
spend above ~5% of gold (walls too fragile), and recall-shopping before minute 3 (start gold too high).
