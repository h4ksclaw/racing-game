# Car 3D Model Research for Racing Game

**Date:** 2026-04-16  
**Focus:** JDM/classic cars (80s-90s Japanese), GLB/FBX, <50k tris, PBR textures, free licenses  
**Status:** We already have an AE86 model. Need: MX-5 Miata, Silvia S13, Civic EG, BMW E30, or similar.

---

## 1. Sketchfab (Best Source for Free Downloadable Models)

Sketchfab is the #1 source. Use the web UI to search — JS-rendered so can't scrape programmatically.

### Search Strategy
- URL: `https://sketchfab.com/search?features=downloadable&licenses=cc6074949a22c696&sort_by=-likeCount&type=models&q=CAR+NAME`
- Filter: **Downloadable** + **CC Attribution** (license `cc6074949a22c696`)
- Sort by: Most Liked (quality filter)
- Always check: GLB/GLTF download available, poly count in model details

### Specific Searches to Run
| Car | Search URL |
|-----|-----------|
| Nissan Silvia S13 | `https://sketchfab.com/search?downloadable=true&licenses=cc6074949a22c696&q=silvia+s13&type=models` |
| Mazda MX-5 Miata | `https://sketchfab.com/search?downloadable=true&licenses=cc6074949a22c696&q=mx5+miata&type=models` |
| Honda Civic EG | `https://sketchfab.com/search?downloadable=true&licenses=cc6074949a22c696&q=honda+civic+eg&type=models` |
| BMW E30 | `https://sketchfab.com/search?downloadable=true&licenses=cc6074949a22c696&q=bmw+e30&type=models` |
| Generic JDM | `https://sketchfab.com/search?downloadable=true&licenses=cc6074949a22c696&q=jdm+car&type=models` |
| Low poly car | `https://sketchfab.com/search?downloadable=true&licenses=cc6074949a22c696&q=low+poly+car&type=models` |

### Known Good Sketchfab Creators (upload free CC models)
- **Quaternius** — low-poly game assets, CC0, very game-ready
- **polyquarry** — various free vehicles
- **ArthurK** — stylized vehicles

### What to Check Per Model
1. Poly count (model page shows this)
2. Download formats (GLB = best for web/Three.js)
3. License (CC-BY = attribution required, CC0 = no strings)
4. PBR textures included (check model page screenshots)

---

## 2. Poly Pizza (poly.pizza)

**URL:** https://poly.pizza  
**License:** CC0 (public domain)  
**Formats:** OBJ, FBX, GLTF/GLB  
**Note:** Stylized/low-poly aesthetic. Good for game-ready models.

### Search
- Browse: https://poly.pizza/explore (filter by "Vehicle")
- Search: `https://poly.pizza/search?q=car`

### Pros
- All free, all CC0
- GLB downloads available
- Game-ready, optimized
- No attribution required

### Cons
- Stylized art style (may not match JDM aesthetic)
- Limited specific car models — more generic vehicles
- No PBR textures (mostly flat colors)

### Action
- Browse for generic/retro car shapes
- May need to find a close match and reskin

---

## 3. Kenney.nl

**URL:** https://kenney.nl  
**License:** CC0 (public domain)  
**Formats:** FBX, OBJ, blend (source)

### Available Packs
| Pack | URL | Notes |
|------|-----|-------|
| **Car Kit** | https://kenney.nl/assets/car-kit | ✅ Confirmed exists. Includes kart racers, debris. FBX format. Low-poly style. |
| **Vehicle Pack** | https://kenney.nl/assets/vehicle-pack | Generic vehicles, may have cars |
| **City Pack** | https://kenney.nl/assets/city-pack | May include cars |

### Car Kit Details
- Download: `https://kenney.nl/media/pages/assets/car-kit/a9b1e99e92-1775131960/kenney_car-kit.zip`
- Includes: multiple car styles, kart racers (v3.0+)
- Format: FBX (convert to GLB with `gltf-pipeline` or Blender)
- Poly count: Very low (~500-2000 tris per car)
- PBR: No — flat colors only
- Style: Kenney's signature low-poly, may not match JDM aesthetic

### Action
- **Already using Kenney assets** — check if Car Kit has usable models
- Good for placeholder/testing but likely too stylized for final game

---

## 4. OpenGameArt.org

**URL:** https://opengameart.org  
**License:** Various (CC-BY, CC-BY-SA, GPL)  
**Formats:** Usually blend, OBJ, DAE

### Search
- https://opengameart.org/art-search-advanced?keys=car&field_art_type_tid%5B%5D=9&sort_by=count&sort_order=DESC
- (field_art_type_tid=9 = 3D models)

### What You'll Find
- Mostly indie/artistic car models, not realistic JDM
- Some racing game packs
- Quality varies widely
- Often needs cleanup work

### Pros
- Truly free for games
- Some good low-poly options
- Community-reviewed

### Cons
- Unlikely to find specific JDM models
- Inconsistent quality
- Formats may need conversion

---

## 5. CGTrader Free Section

**URL:** https://www.cgtrader.com/free-3d-models?keywords=car  
**License:** Various free licenses — check per model  
**Formats:** FBX, OBJ, max, blend

### Search URLs
- Free cars: `https://www.cgtrader.com/free-3d-models/car`
- JDM: `https://www.cgtrader.com/free-3d-models?keywords=jdm`
- Low poly: `https://www.cgtrader.com/free-3d-models/low-poly/car`

### Pros
- Large selection
- Some high-quality free models
- Mix of realistic and stylized

### Cons
- License varies per model (some require attribution, some commercial only)
- Poly counts often too high (50k-500k tris) — need decimation
- May require registration to download
- FBX/OBJ only — need GLB conversion

---

## 6. TurboSquid Free Section

**URL:** https://www.turbosquid.com/Search/3D-Models/free/car  
**License:** Various free licenses  
**Formats:** FBX, OBJ, max

### Notes
- Similar to CGTrader but fewer free options
- Models tend to be higher poly (arch-viz quality)
- License terms can be restrictive for games
- **Lower priority** — CGTrader and Sketchfab are better

---

## 7. Alternative Sources Worth Checking

### Sketchfab Specific Collections
- `https://sketchfab.com/Quaternius/collections` — CC0 game assets
- `https://sketchfab.com/playground/playground-s-assets` — curated free assets

### BlenderKit (blenderkit.com)
- Free tier with CC0/CC-BY models
- Plugin-based but has web browsing
- Some vehicle models available

### GameDev Market / Itch.io
- https://kenney.itch.io/ — Kenney's itch.io (same assets)
- https://itch.io/game-assets/tag-cars — community car assets, some free

### Open Source Racing Games
- **SuperTuxKart** — has car/kart models (GPL license)
- **VDrift** — open source racing game with car models
- **TORCS** — open source racing simulator

---

## Recommendation / Action Plan

1. **Sketchfab first** — search for each target car with downloadable+CC filters. This is the most likely source for JDM models.
2. **Poly Pizza** — browse for any close matches (CC0, game-ready)
3. **Kenney Car Kit** — download for placeholders (already confirmed available)
4. **CGTrader free** — backup option, check poly counts carefully
5. **If no specific JDM models found** — consider:
   - Commissioning a model (cheap on Fiverr/CGTrader, ~$50-200)
   - Using a generic car and reskinning
   - Creating a simple model from scratch in Blender (box modeling a sedan isn't hard)

### Download Checklist
For each candidate model, verify:
- [ ] GLB or FBX format
- [ ] Poly count < 50k tris
- [ ] PBR textures (or flat color acceptable)
- [ ] License allows game use
- [ ] Correct scale (import and check in Three.js)
- [ ] UV-mapped properly
- [ ] No embedded watermarks

---

*Research done via web fetch. Most sites are JS-rendered so manual browsing recommended for final selection.*
