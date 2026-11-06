# Project Lumen: Art Bible

**Version:** 1.0 (art direction locked)
**Owner:** Art Director
**Applies to:** all heroes, minions, environment, VFX, UI, and renderer configuration

> **Status note.** The central gameplay twist is still being selected. This bible defines the visual direction that does not depend on that choice. Section-specific adaptations (mechanic-driven VFX, objective art, state-dependent UI) will be appended after selection. Where a rule below must change for the twist, the appendix will say so explicitly.

---

## 1. Vision & Pillars

Project Lumen is a browser-first 3D MOBA that looks like a lacquered object brought to life. Players move game pieces across a painted board that glows from within.

**Visual pillar: "Lacquer & Light."**

- **Lacquer:** surfaces are glossy, layered, and hand-finished. Think enamel, lacquered wood, carved stone, and gold-leaf inlay.
- **Light:** the world is lit like paper lanterns over dark water. Light is the signal. Heroes and abilities carry it; the environment recedes.

Supporting principles, in priority order:

1. **Readable first.** If a style choice costs readability, readability wins.
2. **Stylized, not sketchy.** Apply the same graphic rules everywhere.
3. **Runs everywhere.** A mid-range phone in a browser is the baseline, not a stretch goal.

## 2. Setting & World Tone

The **Shoals of Aurel** is a mythic archipelago of floating islands above a sea of luminous cloud. The tone is ceremonial and quietly wondrous, not grim. Ruins are old and cared for: stone is weathered, lacquer is chipped but kept, gold leaf is worn at the edges.

| Use | Avoid |
|---|---|
| Rounded forms, stepped terraces, symmetrical shrines | Photographic textures, grime, dirt decals |
| Paper lanterns and braziers as visible light sources | Realistic fur, skin pores, cloth weave |
| Lacquer, enamel, gold leaf, carved stone, silk banners | Chrome, brushed metal, glossy PBR reflections |
| Cloud and mist as the world's horizon | Hard skyboxes with visible geometry |

## 3. Readability Rules

**Camera:** top-down MOBA, 55° pitch, 38° vertical FOV, follows the hero with a fixed angle. Phone reference viewport: 390 x 844 CSS px.

| # | Rule | Test |
|---|---|---|
| R1 | Every hero reads as a silhouette at **64 px tall** on a phone. | Grayscale screenshot at 64 px; the hero's class and signature shape must be identifiable. |
| R2 | Value hierarchy is strict: ground < props < minions < heroes < ability VFX < UI. | Squint test on a full-map screenshot; the order must hold. |
| R3 | Environment chroma is capped at **35%** of maximum; heroes run at full chroma. | Check HSL saturation in the color pass. |
| R4 | Gameplay VFX are the highest-contrast elements in the scene. | Compare contrast ratio against the local terrain. Move VFX to brighter values if needed. |
| R5 | Team identity never depends on hue alone. | Dawn and Dusk must also differ by banner shape and rim pattern. |
| R6 | Outline weight is set by class (see Section 5). | Inspect at 1x and at 3x DPR on a phone. |

**Value targets (approximate CIE L\*):**

| Layer | L\* range | Chroma | Notes |
|---|---|---|---|
| Ground and sea | 22 to 38 | Low | Darkest layer. Cloud sea sits at the bottom of this range. |
| Props and architecture | 35 to 55 | Low to medium | Terrace stone and lacquer accents. |
| Minions | 50 to 70 | Medium | Team-tinted, flat-shaded. |
| Heroes | 55 to 85 | Full | Brightest solid forms. Pale highlights reach 90. |
| Ability VFX | 75 to 100 | Full | Additive; the only layer allowed to clip to white. |
| UI | Context-dependent | Full | Sits above the scene; must hold contrast against any background. |

## 4. Color

### 4.1 Team and gameplay signals (colorblind-safe)

Dawn (amber) and Dusk (cyan) sit on the blue-yellow axis, which stays distinct under protanopia, deuteranopia, and tritanopia. Every hero palette must pass Color Oracle simulation for all three before approval. Team identity is always reinforced by shape (R5).

| Role | Name | Hex | Usage |
|---|---|---|---|
| Dawn primary | Amber | `#F2A541` | Dawn rim light, ally ground decals, banners |
| Dawn highlight | Pale Gold | `#FFD58A` | Specular glints, ability peak, eyes |
| Dusk primary | Teal Cyan | `#3FC1C9` | Dusk rim light, ally ground decals, banners |
| Dusk highlight | Foam Cyan | `#A8F0F2` | Specular glints, ability peak, eyes |
| Enemy hostile | Ember Magenta | `#E8457A` | Damage telegraphs, all enemy-side ground decals |
| Neutral | Moss Green | `#7FB069` | Jungle camps and neutral objectives |

Allied effects never use `#E8457A`. Hostile effects never use Dawn or Dusk primaries.

### 4.2 Environment palette

| Role | Name | Hex | Usage |
|---|---|---|---|
| Cloud deep | Slate Indigo | `#1E2240` | Sea base, darkest ground, shadow tint |
| Cloud light | Indigo Haze | `#3A4170` | Sea surface, distant fog color |
| Terrace | Stone | `#8C8577` | Base terraces, ruins, walls |
| Growth | Moss | `#5E7A4A` | Grove floors, grass edges, vines |
| Accent | Lacquer Red | `#9E3B2E` | Pillars, banners, wood trim (use sparingly) |
| Ornament | Gold Leaf | `#C9A24B` | Inlay and trim on environment only |

### 4.3 Color rules

- Gold leaf appears only on environment and UI trim. It never appears on team-tinted or hostile elements, to avoid confusion with Dawn amber.
- Pure white is capped at 92% value. Pure black is never used. Shadows are cool indigo and ink is warm near-black `#1A1424`.
- Environment saturation is capped by R3. Heroes are the only full-chroma solids outside VFX.

## 5. Lighting & Rendering

**Light rig (all tiers):**

- One **warm key** directional light, color approximately `#FFD9A0`.
- One **cool hemisphere fill**: sky `#A8B4E8`, ground `#1E2240`.
- **Rim light** on every hero and minion, colored with the team primary, from the side opposite the camera. Rim strength is a hero-authored value, typically 0.6 to 0.9.
- **Baked vertex AO** on environment meshes. No real-time AO on mobile.

**Cel shading:**

- Three bands: shadow (about 0.45 of lit value), mid (about 0.75), and lit (1.0).
- Band colors come from a single **1024 x 1024 gradient-map atlas** (Section 13). Each material family samples its own row.
- Specular is a hard, shaped highlight from the Pale Gold or Foam Cyan highlight color.

**Outlines (inverted hull):**

| Class | Width at 1080p-equivalent height | Color |
|---|---|---|
| Hero | 2.5 px | Ink `#1A1424` |
| Minion | 1.75 px | Ink, 80% opacity |
| Prop | 1.0 px | Ink, 60% opacity |
| Terrain | 0 (no hull) | n/a |

Outline width scales with viewport height, not DPR. Hull extrusion is authored per mesh and clamped to avoid cracks on sharp corners.

**Fog:** exponential, toward Indigo Haze `#3A4170`, starting at roughly 60% of the camera's far range. It dissolves the map edge into the cloud sea.

**Shadows:**

- Low and Medium tiers: **blob shadows** only, under heroes and minions, as a soft decal.
- High tier: one soft shadow map from the key light, 2048 px, PCF filtering, casting from heroes and large props only.

## 6. Characters

### 6.1 Proportions

- Chunky, about **5.5 heads tall**. Head is large, torso is compact, legs are short and planted.
- **Oversized hands and weapons.** A weapon's readable shape must survive at 64 px.
- Posture is heroic and forward-leaning, with the center of mass low.

### 6.2 Signature shapes

Each hero owns one **signature shape**: a crescent, a lantern, a spire, a ring, a wedge, and so on. The shape appears in four places:

1. Silhouette (a headdress, weapon head, or cape edge)
2. Ability VFX (the shape of the primary effect's leading edge)
3. UI icon (on the medallion)
4. Ground decal (the hero's selection ring is built from it)

No two heroes may share a signature shape. Each shape is reviewed against the others at 64 px.

### 6.3 Materials

- Lacquer base with a gloss map; enamel for trims; gold leaf on accessories only.
- Maximum **3 material slots per hero** on the mobile LOD, and 5 on high.
- Color comes from the gradient map and team rim, not from texture detail.
- No normal maps on mobile LODs. High tier may use a single normal map for fine carving.

### 6.4 Budgets

| Item | High tier | Medium tier | Low tier (mobile) |
|---|---|---|---|
| Triangles (hero LOD0) | 6,000 to 9,000 | 4,500 | 3,000 |
| Bones | 40 max | 40 max | 40 max |
| Hero texture | 1 shared atlas, 1024 x 1024 | Same | Same |
| Materials | 5 | 4 | 3 |
| Draw calls per hero | 3 | 2 | 1 to 2 |

## 7. Environment & Map Art

The Shoals are built from stepped terraces, floating stone plates, and cloud. Each zone has a distinct role and palette emphasis, but all zones share the value hierarchy in R2.

| Zone | Role | Dominant palette | Notes |
|---|---|---|---|
| **Base terraces** | Spawn and defense. Tiered stone with lacquer-red shrines. | Stone `#8C8577`, Lacquer Red `#9E3B2E` accents | Highest architecture density. Keep ground values darkest of any zone. |
| **Lanes** | Combat corridors. Paved stone bridges between plates. | Stone, Indigo Haze | Low prop density. Clear center lines so minions and VFX read. |
| **River of cloud** | Crossing and vision line. Luminous cloud sea with drifting mist. | Slate Indigo `#1E2240` to Indigo Haze `#3A4170` | Brightest ambient glow in the map. Use sparingly so heroes still stand out. |
| **Jungle groves** | Neutral camps. Dense moss canopy and hanging lanterns. | Moss `#5E7A4A`, Neutral Moss Green `#7FB069` for camp markers | Medium contrast. Camps use Moss Green markers, never team colors. |

**Environment asset budgets (per instance, mobile tier):**

- Props: 2,000 triangles max, 1 material.
- Terrain tiles: 8,000 triangles max per chunk, with baked AO.
- Lanterns and braziers: emissive mesh with a flipbook glow, capped at 40 visible.

## 8. Animation

**Principles:** snappy, anticipatory, and posed. Motion reads before detail does.

- **Anticipation:** 3 to 6 frames of wind-up on every attack or ability, authored at 30 fps.
- **Strong poses:** key poses must hold for at least 3 frames of the 30 fps authoring rate.
- **Smear frames:** fast attacks use 1 stretched frame between key poses. Limit smears to the weapon and the hero's signature shape.
- **Hit-stop:** on impact, freeze the attacker and target for **2 to 3 frames** at 60 fps (33 to 50 ms). Hit-stop applies to the hero that landed the hit and the target only.
- **Idle:** continuous breathing (chest and shoulder bob, 2 to 3 second cycle) plus a **personality fidget** every 8 to 15 seconds. Each hero has one fidget that expresses its character.

**Animation budget:** 40 bones max per hero. Shared skeleton where possible. Clip count per hero: up to 24 (idle, move, basic attacks, abilities, reactions, death).

## 9. VFX Language

**Shape language:**

| Shape | Meaning |
|---|---|
| Circle | Area of effect (radius) |
| Arrow or wedge | Direction (skillshots, dashes) |
| Line | Persistent beam or lane effect |
| Ring | Cooldown pulse, reveal, or channel |

**Telegraphs:** ground decals in team color for allies and `#E8457A` for enemies. Telegraphs use a 20 to 40% fill with a solid outline. Fill fades in before the effect, and the effect uses the highlight color at peak.

**Construction:**

- **Mesh-based** for shapes and geometry (ribbons, wedges, shockwaves).
- **Flipbook** for particle-like bursts. Sheets capped at **512 x 512**, with 8 to 16 frames.
- **Additive blending** only for glow. Additive layers are capped at **3 overlapping per screen region**. Use alpha blending for solid shapes.

**Particle budgets (concurrent active particles):**

| Tier | Active particles | Additive layers | Notes |
|---|---|---|---|
| High | 1,200 | 3 | Full secondary sparks |
| Medium | 600 | 3 | Secondary sparks halved |
| Low | 300 | 2 | No secondary sparks, no trails |

## 10. UI / UX Visual Language

**Enamel plaque panels:** rounded rectangles with a glossy enamel fill (Indigo Haze base, Stone for secondary panels) and a **gold-leaf trim** on the outer edge. Gold trim is 2 px at 1x.

**Touch targets:** minimum **48 dp** on all interactive elements, with at least 8 dp spacing.

**Ability medallions:** round lacquer medallions with the hero's signature shape as the icon. The cooldown sweep is a Pale Gold arc on Dawn and a Foam Cyan arc on Dusk. Medallion sizes: 64 dp (primary abilities), 48 dp (secondary).

**Typography:**

| Use | Typeface | Notes |
|---|---|---|
| Headers and titles | Cinzel (or equivalent display serif) | Uppercase for section titles only |
| Numbers, body, labels | Inter (or equivalent humanist sans) | Tabular figures for stats and timers |
| Damage numbers | Inter Bold | Dark outline (`#1A1424`), 2 px. Scales with damage. |

**Damage numbers:** colored by type. Physical uses Pale Gold, magical Foam Cyan, true damage white, heal Moss Green. Enemy-inflicted damage uses `#E8457A` only as a tint on the outline, never as the fill.

## 11. Audio-Visual Tone Notes

- Lanterns and chimes accompany light-based abilities. Stone impacts are low, resonant thuds.
- Music is modal and pentatonic, with a bright lead for Dawn and a cooler, airier lead for Dusk, so teams are distinct without relying on hue.
- Visual hit-stop and audio impact should land on the same frame. A mismatch is a bug.

## 12. Technical Budgets per Tier

| Setting | Low (mobile) | Medium | High |
|---|---|---|---|
| Target frame rate | 30 fps | 60 fps | 60 fps |
| Device pixel ratio cap | 1.0 | 1.5 | 2.0 |
| Shadows | Blob only | Blob only | Soft shadow map, 2048 px |
| Outline | On, hero and minion only | On, all classes | On, all classes |
| Bloom | Off | Half-res, threshold 0.9 | Full-res, threshold 0.85 |
| Active particles | 300 | 600 | 1,200 |
| Hero triangles | 3,000 | 4,500 | 6,000 to 9,000 |
| Draw calls per frame | 150 max | 250 max | 400 max |
| Texture memory | 128 MB max | 256 MB max | 512 MB max |
| Fog | On | On | On |
| Rim light | On | On | On |
| Specular highlight | Off | On | On |

Tier selection is automatic on first load using a short GPU benchmark and device class. Players can override it in settings.

## 13. Asset Pipeline

**Formats:**

- **glTF 2.0 (.glb)** for all 3D assets.
- **KTX2 (Basis Universal)** for all textures.
- **meshopt** compression as the default for geometry. **Draco** is allowed only for large static environment meshes, after profiling.
- Gradient-map atlas and UI sprite sheets ship as KTX2 and PNG fallback.

**Folder layout** (all art under `client/public/assets`):

```
client/public/assets/
  heroes/<hero_id>/        model_lod0.glb, model_lod1.glb, anims.glb, icon.ktx2
  minions/<minion_id>/     model_lod0.glb, model_lod1.glb
  env/<zone>/              props/, terrain/, lanterns/
  vfx/<effect_id>/         mesh/, flipbook_512.ktx2
  ui/                      atlas_ui.ktx2, medallions/, plaques/
  textures/                gradient_map_1024.ktx2, noise_shared.ktx2
  fonts/                   cinzel.woff2, inter.woff2
```

**Naming conventions:**

- All files: `lowercase_snake_case`. No spaces, no version numbers in names (use git history).
- Heroes: `hero_<id>_<lod>`, for example `hero_lanternbearer_lod0.glb`.
- Environment: `env_<zone>_<asset>_<variant>`, for example `env_base_pillar_a.glb`.
- VFX: `vfx_<ability>_<kind>`, for example `vfx_wedge_dash_flipbook.ktx2`.
- Materials: `mat_<family>_<name>`, for example `mat_lacquer_red_gloss`.
- Bones: `root`, `spine_01` through `spine_03`, `head`, `hand_l`, `hand_r`, `weapon_socket`, and so on. Left and right are always suffixed.

**Export checklist:** apply transforms, a 1 unit = 1 meter scale, one origin at the feet, a single UV set, and a baked AO vertex channel for environment.

## 14. Review Checklist for New Assets

Every new asset must pass this list before merging:

- [ ] Triangle count is within the tier budget (Section 6.4, 7, or 9).
- [ ] Bone count is 40 or fewer.
- [ ] Materials are within the per-class limit.
- [ ] Textures are KTX2 and reference only the shared gradient map where applicable.
- [ ] Signature shape (heroes) is distinct from all other heroes at 64 px.
- [ ] Grayscale silhouette test passed at 64 px.
- [ ] Value falls within the layer target in Section 3 (R2).
- [ ] Environment chroma is 35% or lower (R3).
- [ ] Team colors pass protanopia, deuteranopia, and tritanopia simulation (Section 4.1).
- [ ] Outline width matches the class table in Section 5.
- [ ] Animation includes anticipation, a hold on impact, and a fidget where applicable.
- [ ] VFX uses the correct shape language and team or hostile color.
- [ ] Additive layers stay within the cap in Section 9.
- [ ] Renders correctly at Low, Medium, and High tiers, with a phone screenshot at 390 x 844.
- [ ] File names, folder placement, and bone names follow Section 13.
