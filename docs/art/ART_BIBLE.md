# Project Lumen: Art Bible

**Version:** 2.0 (direction pivot: Frost & Hearthfire)
**Owner:** Art Director
**Applies to:** the Skarnveld map, heroes, minions, environment, VFX, UI, camera, renderer

> **Status note.** The core gameplay twist is still pending selection. This bible fixes the visual direction, which does not depend on that choice. Mechanic-driven adaptations (objective art, state-dependent VFX and UI) will be appended after selection. Where a rule must change for the twist, the appendix will say so.

---

## 1. Vision & Pillars

Project Lumen is a browser-first 3D MOBA in a cold, vast, weathered northern wilderness. Two clans fight across a high valley where warmth exists only as carried or built fire.

**Visual pillar: "Frost & Hearthfire."**

- **Frost:** the world is cold, large, and old. Snow, stone, pine, and mist fill the frame, and distance is measured in haze.
- **Hearthfire:** warmth is a signal. Braziers, torches, lanterns, and banners are the only warm light sources.

**Look target:** grounded PBR realism with painterly atmosphere. Surfaces are believable, never photographed; aerial perspective and height fog do the work that fine detail would otherwise do.

**Priorities:** (1) readable at third-person distance; (2) grounded, not grimy; (3) runs on a mid-range phone in a browser.

## 2. Setting & Tone

**The Skarnveld** is a high mountain valley ringed by snow-capped peaks. A glacial river runs diagonally from the north-west corner to the south-east corner. Pine forest covers the valley floor, with mossy boulders throughout. Carved standing stones and ruined barrow-forts belong to the Oru-Taen, a forgotten people with no living heirs. The clans now holding the valley build on their ruins without fully understanding them.

All names are original to Project Lumen.

- **Hearthguard** (Dawn) holds the **south-west** fort, on the south bank.
- **Rimewardens** (Dusk) holds the **north-east** fort, on the north bank.

**Tone:** austere, enduring, quietly melancholy, with moments of human warmth. Not grimdark, not cozy. Avoid sunny meadows, tropical foliage, fresh-looking ruins, clutter, and polished chrome.

## 3. Readability in Third Person

**Camera:** over-right-shoulder, 70° vertical FOV, 4.5 m boom that collides with terrain and trunks. Scroll zooms to first person; V toggles directly. In first person only hands, forearms, and the held item are drawn.

| # | Rule | Test |
|---|---|---|
| R1 | Heroes are identifiable at **30 m** on a phone. | Grayscale screenshot at 390 x 844; class and signature readable. |
| R2 | Value order: snow and ground < props < minions < heroes < ability VFX < UI. | Squint test on a mid-map screenshot. |
| R3 | Enemy team-rim appears **only when targeted or in ability range**. | Untargeted, out-of-range enemies show a faint silhouette only. |
| R4 | Health bars appear within **40 m**. Beyond that, only targeted units show bars. | Check at 41 m. |
| R5 | Telegraphs are **ground decals**, never floating icons. | Enemy telegraphs use `#E8457A`; allied telegraphs use team color. |
| R6 | Off-screen threats get **edge chevrons** pointing toward the source. | Chevron color follows threat type; fades once the source is on screen. |
| R7 | Team identity never depends on hue alone. | Banner shape and rim pattern differ (Section 4.1). |

## 4. Color

### 4.1 Team and gameplay signals

Hearthguard (warm) and Rimewardens (cool) sit on the warm-cool axis, which holds under protanopia, deuteranopia, and tritanopia. All team assets must pass Color Oracle simulation for all three.

| Role | Name | Hex | Usage |
|---|---|---|---|
| Hearthguard primary | Ember Orange | `#E07A2E` | Solid rim band, ally decals, fort markers |
| Hearthguard cloth | Hearth Red-Brown | `#7A3423` | Banner cloth, trim |
| Rimewardens primary | Glacial Blue | `#4FA3D9` | Dashed rim band, ally decals, fort markers |
| Rimewardens cloth | Slate Blue | `#4A5A70` | Banner cloth, trim |
| Enemy hostile | Telegraph Rose | `#E8457A` | Enemy telegraphs, edge chevrons, enemy target outline |
| Neutral | Muted Moss | `#7FB069` | Pine-grove camps, neutral objectives |

- `#E8457A` never appears on allied elements. Team colors never appear on hostile elements.
- Team colors stay on rims, decals, banners, and markers. They never tint fire, Heartstones, or terrain.

### 4.2 Environment and light

| Role | Name | Hex | Usage |
|---|---|---|---|
| Fresh snow | Drift White | `#E9EEF2` | Drifts, ridge caps (max 92% value) |
| Shaded snow | Rime Shadow | `#9AA9B8` | Snow in shade, frost VFX |
| Bedrock | Granite Gray | `#6E6A66` | Cliffs, slopes |
| Road | Packed Earth | `#5B4A3A` | Lane roads |
| Forest floor | Needle Brown | `#3D3328` | Ground under pines |
| Pine | Pine Green | `#2E4A36` | Canopy (desaturated) |
| Carved stone | Barrow Stone | `#7D776C` | Standing stones, fort walls |
| Meltwater | Glacial Teal | `#3E5F73` | River body |
| Fog and horizon | Haze Blue | `#B7C4CF` | Fog color, horizon sky |
| Shadow tint | Cold Indigo | `#1B2232` | Shadows, grade |
| Flame | Flame Amber | `#FFB25E` | Fire and brazier light (not team-tinted) |
| Runic light | Carved Light | `#F4E7C1` | Heartstones, runes, Lumen |

**Chroma cap:** environment HSL saturation is 35% or lower. Heroes and VFX are the only full-chroma elements.

## 5. Lighting & Atmosphere

**Default time of day:** late afternoon under thin overcast. The sun sits at 20 to 28 degrees, filtered by cloud, for crisp but soft-edged shadows. The sun is **cold-neutral** (`#DDE6F0`) even when low, so warmth stays exclusive to fire.

**Light rig (all tiers):**

- **Key:** one directional sun light.
- **Sky fill:** HDRI image-based lighting from a CC0 Poly Haven overcast sky, prefiltered at build time.
- **Fire:** point lights from braziers, torches, and lanterns, capped per tier (Section 13).
- **Team rim:** a directional rim from the side opposite the camera, tinted by team.

**Tone and grade:** ACES filmic tone mapping with fixed exposure per time of day (no auto-exposure). Cool shadows, warm highlights reserved for fire. Vignette at about 25%. **Bloom only on fire and magic.**

**Fog:** exponential, colored `#B7C4CF` and matched to the horizon so the map edge dissolves into sky. Fog begins at about 60% of far range. Height fog thickens in the river valley and pine groves. Peaks are layered distant silhouettes, lighter and bluer with each ridge.

**Shadows:** one sun cascade that follows the player (sizes in Section 13). Heroes, large props, and standing stones cast shadows; small props receive only.

## 6. Materials & Textures

**Pipeline:** `MeshStandardMaterial` everywhere. Source textures are CC0 photoscans from ambientCG or Poly Haven at **1K**. Only the HDRI ships above 1K.

| Family | Character | Key properties |
|---|---|---|
| Stone | Carved, weathered, lichen-patched | Roughness 0.7 to 0.9 |
| Wood | Larch and pine, split, aged | Roughness 0.8 |
| Forged iron | Hammered, rust at edges | Metalness 1, roughness 0.4 to 0.6 |
| Boiled leather | Matte, creased, worn | Roughness 0.6 to 0.8 |
| Carved bone | Ivory-gray, polished at touch points | Roughness 0.5 |
| Snow and ice | Fresh, granular, glassy when packed | Roughness 0.3 to 0.9 by age |

**Terrain splatting:** one 1024 x 1024 RGBA mask over the 160 m map (about 16 cm per texel).

- **R:** snow, from height above the snow line and upward-facing normals.
- **G:** bedrock, from slope above about 35 degrees.
- **B:** forest floor and grass, the default on gentle slopes.
- **A:** packed road, painted from lane splines.

Blend edges use a shared noise texture to avoid banding. Steep rock uses triplanar sampling. River banks lower roughness within 2 m of water.

**Formats:** KTX2 with Basis Universal. ETC1S for albedo, UASTC for normal and packed ORM (occlusion, roughness, metalness). Mipmaps on everywhere.

## 7. Characters

### 7.1 Proportions

- Realistic proportions at about **7.5 heads tall**. Weapons are believable in scale and carried with weight.
- Layered materials: forged iron, boiled leather, wool, fur trim, carved bone. Color comes from material variation and the team rim, not paint.
- Grounded posture: center of mass low, knees soft, weight visibly shifting.

### 7.2 Signature silhouettes

Each hero has **one clear silhouette signature** readable at 30 m, such as an antlered helm, a great banner on a pole, a lantern staff, or a notched long-axe. No two heroes share one. The signature also drives the hero's ability emblem, so players learn one shape per hero.

### 7.3 Budgets

| Item | High | Medium | Low (mobile) |
|---|---|---|---|
| Hero LOD0 triangles | 15,000 to 25,000 | 10,000 | 6,000 (LOD1) |
| Bones (skinned) | 60 max | 60 max | 60 max |
| Materials per hero | 5 | 4 | 3 |
| Textures per hero | One shared 1K KTX2 atlas | Same | Same |

**Stand-ins:** the current build uses procedural articulated heroes until skinned models arrive. Stand-ins must already use the final bone names, 1 unit = 1 m, and named signature sockets, so the swap is a file replacement, not a rig change.

## 8. Environment & Map Zones

**Map:** 160 m square valley. Hearthguard sits south-west and Rimewardens north-east, with the river between them on the diagonal.

| Zone | Role | Dominant palette | Notes |
|---|---|---|---|
| **Forts** | Spawn and defense. Stone barrow-forts, braziers, a carved Heartstone. | Barrow Stone, Granite Gray, team cloth | Brazier light is the map's main warm source. |
| **Lanes (3)** | Combat corridors. Worn earth roads with wooden lantern posts. | Packed Earth, Rime Shadow | Low prop density. Only the nearest lantern posts get real lights. |
| **Glacial river** | Crossing line. Meltwater, gravel banks, ice shelves. | Glacial Teal, Drift White | Fords marked by standing-stone pairs. Morning fog pools here. |
| **Pine groves** (jungle) | Neutral camps. Dense pine, boulders, lichen. | Pine Green, Lichen Olive, Muted Moss markers | Camp markers use Muted Moss only. |

**Mobile budgets (per instance):** props 2,000 triangles and one material; terrain chunks 8,000 triangles with baked AO; trees instanced, with impostors beyond 60 m; 40 lantern glows visible.

## 9. Animation

**Principles:** weighty, grounded, momentum-driven. Heavy heroes commit; light heroes dart.

- **No root motion.** Movement is server-authoritative. Clips animate in place, and foot placement follows the server's position.
- **Momentum:** locomotion blends from velocity. Accelerate and decelerate in 0.2 to 0.35 s. Turns lean into travel.
- **Anticipation:** light attacks wind up 3 to 4 frames at 30 fps; heavy attacks and ultimates 6 to 10 frames. The wind-up must read at default boom distance.
- **Impact:** heavy hits freeze attacker and target for 2 frames at 60 fps. Light hits do not.
- **Layering:** the lower body drives locomotion; an upper-body mask from the spine up handles casting and aim, so heroes cast while running.
- **Additive layers and ground contact:** breathing and cold reactions sit on any pose. Footsteps sync to foot plants; in snow, feet sink.
- **Idle:** breathing cycle (2 to 3 s), weight shift every 6 to 10 s, one personality fidget per hero.

**Clip budget:** 24 per hero (idle, eight-direction move, attacks, abilities, reactions, death). First-person arms use a separate rig that shares clips where bone names match.

## 10. VFX

| Element | Look | Color | Notes |
|---|---|---|---|
| Frost | Crystal shards, rime sparkle, cold mist | Rime Shadow, pale blue-white | Slows; never reads as healing |
| Ember | Flame flipbooks, cinders, heat shimmer | Flame Amber | Fire is the only warm VFX element |
| Storm | White-blue arcs, lightning ribbons | Glacial white | Short, high-contrast, audible |
| Runic | Projected glyphs, slow pulses from stone | Carved Light | Magic and Heartstones |

**Grounded behavior:** sparks fall, smoke rises then drifts with wind, frost spreads across surfaces and stops at edges. No unmotivated floating particles.

**Team color:** used on a VFX only when the effect carries team meaning, such as an allied healing ring. Otherwise, element color.

**Telegraphs:** ground decals, 20 to 40% fill with a solid outline. Allied telegraphs use team color; enemy telegraphs use `#E8457A`. The fill fades in before the effect, and the effect peaks at outline brightness. Shape language: circle for radius, wedge for direction, line for beam, ring for cooldown or channel.

**Construction:** fire uses additive flipbooks (512 x 512 max, 8 to 16 frames) plus tier-capped point lights. Shards, arcs, and shockwaves are meshes. Additive blending is for glow and fire only, capped at 3 overlapping layers per region (2 on Low).

| Tier | Active particles (incl. snow) | Snow share | Secondary sparks |
|---|---|---|---|
| High | 1,200 | 400 | Full |
| Medium | 600 | 200 | Halved |
| Low | 300 | 150 | None |

## 11. UI / HUD

The HUD is carved into the world: thin, minimal, and quiet until something matters.

- **Compass bar** (top center): thin horizontal bar with carved-stone ends, showing objectives and fort markers. Markers use banner shape (square for Hearthguard, swallow-tail for Rimewardens).
- **Resource bars** (bottom center): three thin stacked bars. Health is Brick `#B8483A`; Lumen is Carved Light `#F4E7C1`; stamina is Rime Shadow `#9AA9B8`.
- **Center reticle:** a 4 px dot, plus a 1 px ring only while aiming.
- **Ability bar** (bottom): slots framed in carved stone and iron, showing the hero's emblem and a Carved Light cooldown sweep. States use shape and dimming, not color alone.

**Typography:** Cinzel or Cormorant SC for titles (uppercase for section titles only). Inter for all numbers and labels, with tabular figures for timers and stats.

**World UI:** health bars 2 px tall with a team-colored edge. Damage numbers are Inter Bold with a dark outline.

**Mobile:** left virtual stick; right-side drag to look; ability buttons on a right-thumb arc. **All touch targets are at least 52 dp**, with 8 dp minimum spacing. Compass and bars stay clear of thumb arcs and the top safe area.

## 12. Audio-Visual Tone

- **Wind** is the constant bed. It rises near ridges and the river and drops inside pine groves.
- **Horns** mark events. Hearthguard horns are low and resonant; Rimewardens horns are high, hollow, and whistled.
- **Braziers crackle**; torches hiss near snow. **Snow crunches** underfoot, and ice cracks from the river.
- **Music** is sparse: drones, low strings, a frame drum, a bell at key moments.
- **Impacts align.** A heavy hit's freeze and audio thud share a frame.

## 13. Performance Tiers & Budgets

Tier is chosen automatically on first load by a short GPU benchmark and device class. Players can override it in settings.

| Setting | Low (mobile baseline) | Medium | High |
|---|---|---|---|
| Target frame rate | 30 fps | 60 fps | 60 fps |
| Device pixel ratio cap | 1.0 | 1.5 | 2.0 |
| Sun shadow | Blob shadows only | One cascade, 1024 px, 24 m | One cascade, 2048 px, 48 m, soft PCF |
| Visible fire point lights | 2 | 4 | 8 |
| Post FX | Grade, vignette | Plus half-res bloom | Plus full-res bloom, layered fog volumes |
| Fog | Exponential | Exponential with noise | Exponential with layered height fog |
| Grass and undergrowth | 25% density | 60% | 100% |
| Active particles | 300 | 600 | 1,200 |
| Hero triangles | 6,000 (LOD1) | 10,000 | 15,000 to 25,000 |
| Hero materials | 3 | 4 | 5 |
| Draw calls per frame | Under 150 | Under 300 | Under 500 |
| Triangles on screen | 300,000 | 800,000 | 1,500,000 |
| Texture memory | 128 MB | 256 MB | 512 MB |

## 14. Asset Pipeline & Licensing

**Sources:** CC0 only, from ambientCG and Poly Haven, plus original work. Downloads go through `tools/assets/fetch-assets.mjs`, which records source URL and fetch date. Any other license needs Art Director approval before import.

**Processing (gltf-transform):** simplify for LODs, meshopt compression (Draco only for large static environment meshes, after profiling). Textures are KTX2; UI sprites WebP with PNG fallback; HDRIs prefiltered at build time.

**Layout** (all art under `packages/client/public/assets`):

```
models/heroes/<hero_id>/      lod0.glb, lod1.glb, anims.glb
models/minions/<minion_id>/   lod0.glb, lod1.glb
models/env/<zone>/            props/, terrain/, lanterns/
models/vfx/<effect_id>/       mesh/, flipbook_512.ktx2
textures/terrain/ textures/materials/ textures/ui/
hdri/    fonts/    CREDITS.md
```

**Credits:** every asset gets a line in `packages/client/public/assets/CREDITS.md`: file path, name, author, source URL, license (CC0 1.0 unless noted), fetch date, and modifications. No asset ships without one.

**Naming:**

- `lowercase_snake_case`; no spaces; no version numbers (use git history).
- Heroes `hero_<id>_<lod>` (e.g. `hero_antlerhelm_lod0.glb`). Environment `env_<zone>_<asset>_<variant>`. VFX `vfx_<element>_<kind>`. Materials `mat_<family>_<name>`. Textures `tex_<family>_<map>_<res>`.
- Bones: `root`, `spine_01` to `spine_03`, `neck`, `head`, `clavicle_l/r`, `hand_l/r`, `weapon_socket_r`. Left and right always suffixed.

**Export checklist:** transforms applied; 1 unit = 1 m; origin at feet; one UV set; baked AO on environment.

## 15. Review Checklist

Every new asset must pass before merging:

- [ ] Triangles, bones, clips, and materials are within the tier budgets (Sections 7.3, 13).
- [ ] Textures 1K KTX2 (WebP for UI); hero signature passes the 30 m grayscale test at 390 x 844.
- [ ] Values follow R2; environment saturation is 35% or lower.
- [ ] Team colors pass three-way colorblind simulation; team identity is not hue alone (R7).
- [ ] Telegraphs are ground decals in the correct color; warm light and bloom are limited to fire and magic.
- [ ] Animation has anticipation, layering where applicable, and no root motion.
- [ ] Additive layers stay within the Section 10 cap.
- [ ] Renders correctly at all three tiers; `CREDITS.md` entry and naming follow Section 14.

## Appendix A — Bulwarks (core twist) art notes

Scope: structures, send units, placement UI and Heartstone feedback for the Bulwarks twist (`docs/design/TWIST_BULWARKS.md`). Values tagged **[P]** are proposals for Art Director sign-off.

**Rule changes for the twist.** R3 covers units and heroes. Enemy structures are map-level, so their team rim shows at all times at low contrast, which lets lane geometry read before anything is targeted. Section 4.1 still holds: team colors never tint Heartstones, so Heartstone feedback uses Carved Light only.

**A.1 Structure silhouettes by level.** Readable at 30 m in grayscale. The Low-tier budget is that of a prop: 2,000 triangles and one material.

| Structure | L1 | L2 | L3 |
|---|---|---|---|
| Watch Tower | Timber-and-stone post, one arrow slit under a flat cap | Iron-banded ring, second slit | Crenellated top, brass-tipped arrow rack above the pines |
| Rime Totem | Carved stone pillar with a rime cap | Two frost bands, crystal shard collar | Crowned pillar, crystal spike ring, Rime Shadow mist column |
| Ember Catapult | Low wooden frame, one throwing arm | Iron-reinforced frame, counterweight box | Twin-arm siege frame, brazier cup on the bed (fire in Flame Amber only) |
| Palisade | Sharpened stakes in 2 m sections | Taller stakes, lashed crossbars | Log-and-stone wall with iron-capped stakes |
| Caltrops | Flat scatter of iron spikes | Spikes in regular rows, rimmed edge | Dense star pattern, frost on the points; reads as ground at 30 m |

**A.2 Placement ghost.** Valid: solid outline in `#7BD389` [P] with a check glyph and a 35% fill. Invalid: dashed outline in `#B5389F` [P] with a cross glyph and the reason text. Invalid magenta must stay distinct from Telegraph Rose (`#E8457A`), since allied UI never uses hostile color. Shape carries the meaning (solid or dashed, check or cross), so the ghost passes R7 and the three-way colorblind simulation. For LANE BLOCKED, the sealing cells outline in the invalid style.

**A.3 Team identity on structures.** Hearthguard: a solid Ember Orange (`#E07A2E`) rim band and a square banner in Hearth Red-Brown cloth. Rimewardens: a dashed Glacial Blue (`#4FA3D9`) rim band and a swallow-tail banner in Slate Blue cloth. Palisades carry only a banner marker at each section end, to keep walls quiet.

**A.4 Range and aura indicators.** Ground decals in the shape language of Section 10: circle for radius, ring for channel. Range rings are a 1 px outline in team color, drawn only in build mode or when a structure is selected. Watch Tower: circles at 13, 14 and 15 m. Ember Catapult: outer ring at 16 m and inner ring at 4 m (minimum range). Rime Totem: 7 m aura as a 20% Rime Shadow wash with a solid team-color edge. Caltrops: footprint in Rime Shadow with charge pips around the edge. Enemy ranges appear only when a hero is in range, drawn in Telegraph Rose.

**A.5 Send units.** Silhouettes must read at 30 m in grayscale.

- **Wolf** (pack of three): low and long-bodied, Rime Shadow coat, frost-tipped tail held straight out at a run. Team marker: a collar band, solid for Hearthguard and dashed for Rimewardens.
- **Draugr Brute:** broad and hunched, bone plates over boiled leather, stone-headed maul. Team marker: a banner pole on the back.
- **Rimetroll (boss):** taller than any hero, rime-plated shoulders, a trailing ice-crust mantle. Team marker: a banner on the left shoulder. Feet sink in snow (ART_BIBLE 9 applies).

No fire, and no team tint on fur, bone or stone. [P] Low-tier triangle budgets: wolf 3,000, brute 4,000, Rimetroll 6,000.

**A.6 Leak feedback on the Heartstone.**

- **Approach:** a hostile within 6 m of the Heartstone gets a Telegraph Rose ground decal under its feet (R5).
- **Leak hit:** a 0.2 s Carved Light pulse, a crack line from the impact point, and a damage number in Inter Bold with a dark outline.
- **Stages:** at 75%, 50% and 25% HP (3,150, 2,100 and 1,050), one rune band dims per stage and cracks spread across the stone. The 25% stage adds a low horn cue (ART_BIBLE 12).
- **Compass bar:** each leak adds a pip to a row beside the Heartstone marker.

No fire, no team color, and no floating icons.
