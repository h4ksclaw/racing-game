# Racing Game — Master Build Plan

## Status: IN PROGRESS

### Phase 1: Performance Foundation
- [x] **Instanced meshes** — Convert 5000 individual scenery meshes to InstancedMesh (1 draw call per type)
  - Current: ~5000 separate mesh objects → ~5000 draw calls
  - Target: ~10 InstancedMesh objects → ~10 draw calls
  - Prerequisite for everything else

### Phase 2: Sky & Lighting
- [x] **Procedural sky** — Three.js Sky addon (turbidity, rayleigh, sun position)
- [x] **Day/night cycle** — Time keyframes interpolating sun/ambient/fog/sky
- [x] **Night mode** — Headlights, street lights, stars, moon
- [x] **Weather: Rain** — Particle system + fog (done in Phase 2)
- [x] **Weather: Rain/Snow/Fog/Cloudy** — All particle systems + fog/light/turbidity modifiers

### Phase 3: Textures & Materials
- [x] **Download ambientCG textures** — 1K JPG packs (color + normal + roughness + AO)
  - Grass, dirt, rock, snow, sand, road, moss, forest floor
- [x] **Texture manager** — Load textures per biome, apply to terrain
- [x] **Terrain shader** — Blend textures by slope/height/distance instead of vertex colors
- [x] **Normal maps on terrain** — Surface detail without more geometry
- [x] **Road texture upgrade** — ambientCG Road007 PBR + lane marking geometry

### Phase 4: Biome System
- [ ] **Biome config interface** — TypeScript types for biome definitions
- [ ] **6 biomes** — Temperate, Autumn, Desert, Alpine, Tropical, Rural
- [ ] **Seed-based selection** — Biome chosen from seed
- [ ] **Per-biome scenery types** — Different tree/plant models per biome
- [ ] **Per-biome atmosphere** — Fog, lighting, sky color

### Phase 5: Weather
- [x] **Rain** — 15k particles + fog (done)
- [x] **Snow** — 8k drifting particles (done)
- [x] **Fog** — Density control (done)
- [x] **Cloudy** — Sky turbidity + dimmed sun (done)
- [ ] **Weather transitions** — Smooth crossfade between states
- [x] ~~Rain/Snow/Fog/Cloudy~~ — Implemented in Phase 2 (see above)

### Phase 6: More 3D Assets
- [ ] **Download additional Kenney packs** — Nature Extended, Farm, City
- [ ] **Quaternius packs** — Additional low-poly models
- [ ] **Per-biome model mapping** — Cacti for desert, palms for tropical, etc.

### Phase 7: Post-Processing & Polish
- [ ] **Bloom** — Light glow for street lights, headlights
- [ ] **SSAO** — Ambient occlusion for depth
- [ ] **Color grading** — Per-biome color shifts
- [ ] **Weather audio** — Web Audio loops (rain, wind, thunder)

### Phase 8: Adaptive Quality
- [ ] **FPS monitor** — Frame time tracking
- [ ] **Quality tiers** — Low/medium/high toggle
- [ ] **LOD system** — Swap mesh detail by distance
- [ ] **Dynamic resolution** — Adjust pixel ratio based on FPS

---

## Design Documents
- `aidocs/biome-system-design.md` — Textures, assets, biome configs, shader pseudocode
- `aidocs/sky-weather-design.md` — Sky, day/night, weather, audio
- `aidocs/terrain-generation-research.md` — Terrain noise research

## Key Files
- `src/shared/track.ts` — Track generation + scenery (pure math, no deps)
- `src/server/index.ts` — Express API (/api/track)
- `src/client/track.ts` — Three.js rendering, terrain, scenery placement
- `track.html` — UI entry point
- `vite.config.ts` — Dev server + proxy config
