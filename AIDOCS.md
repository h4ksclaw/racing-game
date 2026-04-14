# Racing Game — Project Documentation

## Overview

A browser-based procedural racing game built with **Three.js** + **TypeScript**. Tracks are generated server-side using seeded PRNGs and sent to the client as JSON. The client renders terrain, roads, weather, and scenery using custom GLSL shaders and instanced meshes.

**Philosophy:** YAGNI, KISS, DRY. Features built for testing/development are real features.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Browser (Client)                │
│                                                  │
│  track.ts ──► buildScene() ──► Three.js Scene    │
│                  │                               │
│    ┌─────────────┼─────────────┐                 │
│    ▼             ▼             ▼                 │
│  road.ts     terrain.ts   scenery.ts             │
│  (meshes)    (heightmap)  (trees, lights)        │
│                │             │                   │
│                ▼             ▼                   │
│            biomes.ts    procedural-scenery.ts     │
│            (config)     (instanced meshes)        │
│                                                  │
│  sky.ts ──► time-of-day + weather lighting       │
│  weather.ts ──► rain/snow particles              │
│  effects.ts ──► bloom post-processing            │
│  scene.ts ──► shared mutable state               │
└─────────────────────────────────────────────────┘
         ▲                    │
         │   JSON (samples)   │
         │                    ▼
┌─────────────────────────────────────────────────┐
│              Server (Node.js)                    │
│                                                  │
│  server/index.ts ──► /api/track?seed=N          │
│                      │                           │
│                      ▼                           │
│              shared/track.ts                     │
│              (generateTrack - pure math)          │
└─────────────────────────────────────────────────┘
```

## Source Files

### Shared (`src/shared/`)
| File | Lines | Description |
|------|-------|-------------|
| `track.ts` | ~880 | Pure-math procedural track generation. PRNG, noise, spline, sampling, scenery placement. No Three.js dependency — runs in both server and client. |

### Client (`src/client/`)
| File | Lines | Description |
|------|-------|-------------|
| `scene.ts` | ~40 | Central mutable state object shared across all modules. Types for scene, camera, lights, materials, weather. |
| `track.ts` | ~400 | Entry point. Loads track from server (or generates client-side fallback), orchestrates `buildScene()`, UI event handlers, render loop, flyover camera. |
| `road.ts` | ~670 | Road mesh generation: asphalt ribbon, kerbs, grass shoulders, concrete slabs, center line, start/finish checker. All from track samples. |
| `terrain.ts` | ~660 | Heightmap terrain with custom GLSL shader. 7-layer blend (grass, dirt, rock, snow, moss, belowDirt, grassPatch). Height from simplex noise. |
| `biomes.ts` | ~340 | Biome configurations (6 biomes). Each defines textures, tints, thresholds, tree/grass types, fog, lighting. Selection by seed modulo. |
| `scenery.ts` | ~590 | GLB model loading for light posts, instanced scenery placement (trees, rocks, grass), guardrail generation. Per-biome light post models. |
| `sky.ts` | ~370 | Sky dome, time-of-day system (14 keyframes), sun position, ambient color, fog, star field. Weather multiplier applied per-frame. |
| `weather.ts` | ~340 | Weather system: rain/snow particle systems, fog adjustments, road wetness, terrain tint shifts. 6 weather types. |
| `effects.ts` | ~50 | Post-processing: UnrealBloom for night lights, selective bloom via `userData.bloomMult`. |
| `utils.ts` | ~40 | Shared types (V3, TrackResponse, WeatherType, TimeKeyframe), smoothstep utility. |
| `procedural-scenery.ts` | ~440 | Procedural geometry generators for trees, rocks, grass clumps (fallback when no GLB models). |

### Server (`src/server/`)
| File | Lines | Description |
|------|-------|-------------|
| `index.ts` | ~135 | Express server. `/api/track?seed=N` endpoint generates track data using shared `generateTrack()`. |

## Key Data Structures

### TrackSample
The fundamental unit of track data — one point along the road center:
```ts
interface TrackSample {
  point: V3;       // center of road
  left: V3;        // left edge
  right: V3;       // right edge
  kerbLeft: V3;    // left kerb edge
  kerbRight: V3;   // right kerb edge
  grassLeft: V3;   // grass shoulder left
  grassRight: V3;  // grass shoulder right
  binormal: V3;    // perpendicular to tangent (left-pointing)
  tangent: V3;     // forward direction
}
```

### BiomeConfig
Defines all visual parameters for a biome:
- Textures (grass, dirt, rock, moss, etc.)
- Color tints (road, grass, dirt, rock, snow)
- Blend thresholds (snow, rock, moss, grassPatch)
- Tree/grass types and densities
- Fog parameters
- Light post model path

## Systems

### Track Generation Pipeline
1. Seed → Mulberry32 PRNG → deterministic noise
2. Control points → Catmull-Rom spline → dense sample points
3. Each sample: compute left/right edges, binormal, tangent
4. Scenery placement: trees, rocks, grass along edges
5. Server returns JSON, client builds Three.js meshes

### Terrain System
- 2D simplex noise heightmap, sampled at grid vertices
- Custom vertex shader displaces Y by height
- Fragment shader blends 7 texture layers based on height/slope/distance-from-road
- Biome controls texture selection, tints, and blend thresholds
- Fog integrated in shader uniforms

### Weather System
- 6 types: clear, cloudy, rain, heavy_rain, fog, snow
- Rain/snow: THREE.Points particle systems with velocity arrays
- Lighting: sun intensity multiplier applied in sky update loop
- Road: roughness/metalness adjust based on wetness
- Terrain: tint shifts for wet/dark/snowy conditions

### Day/Night Cycle
- 14 time keyframes (hour 0-24) with interpolated colors/intensities
- Sun position from elevation angle
- Street lights: PointLight (default) or SpotLight (Autumn Woods)
- Bloom intensity scales with nightFactor
- Stars visible at night

### Post-Processing
- UnrealBloom for night glow effects
- Selective bloom: objects set `userData.bloomMult` for per-object bloom control

## Biomes (6 total)
| Biome | Character |
|-------|-----------|
| Alpine Meadow | Snowy mountains, pine trees, cool tones |
| Autumn Woods | Orange/brown palette, SpotLight posts with bloom |
| Temperate Forest | Lush green, broadleaf trees |
| Desert Canyon | Sandy, sparse vegetation, warm tones |
| Tropical Jungle | Dense green, palms, humid |
| Rural Countryside | Gentle green, mixed trees, farmland feel |

Selection: `BIOMES[seed % BIOMES.length]`

## Assets

### Textures (`public/textures/`)
15 folders: grass, grass_moss, dirt, dirt_dry, gravel, moss, forest_floor, rock_gray, rock_mossy, rock_dark, sand, sand_desert, snow, path, road_asphalt

Each contains: Color.jpg, NormalGL.jpg, Roughness.jpg

### Car Models (`public/assets/kenney-car-kit/`)
Kenney Racing Kit — GLB format. Key models:
- Cars: race.glb, sedan.glb, sedan-sports.glb, suv.glb, hatchback-sports.glb, race-future.glb
- Karts: kart-oobi.glb, kart-oodi.glb, kart-ooli.glb
- Wheels (separate): wheel-default.glb, wheel-racing.glb, wheel-dark.glb

### Light Posts (`public/assets/kenney-racing-kit/`)
6 biome-specific GLB models + custom GuN.glb for Autumn Woods (SpotLight)

## Development

### Commands
```bash
npm run dev          # Vite dev server
npm run dev:server   # Express API server
npm run build        # tsc + vite build
npm run lint         # biome check
npm run lint:fix     # biome check --write
npm run typecheck    # tsc --noEmit
npm run test         # vitest (watch mode)
npm run test:run     # vitest (single run)
npm run check        # tsc + biome + knip (full check)
```

### Pre-commit Hooks
- **Biome**: auto-formats and lints staged files
- Husky-managed via lint-staged config

### CI (GitHub Actions)
- TypeScript check
- Biome lint
- Knip (dead code detection)
- Vitest unit tests
- Vite production build
- Docker image build

### Testing
- **Vitest** with path aliases (`@shared`, `@client`)
- Tests in `src/**/*.test.ts`
- Current coverage: track generation (PRNG, determinism, sample structure), biome selection
- Run `npm run test` for watch mode, `npm run test:run` for CI

### Code Quality Tools
- **Biome**: formatter + linter (replaces ESLint + Prettier)
- **TypeScript**: strict mode, `--noEmit` for type checking
- **Knip**: dead code / unused dependency detection
- **Husky + lint-staged**: pre-commit formatting

## Tech Debt & Notes

- `road.ts` and `scenery.ts` are large (~600+ lines) — could benefit from splitting mesh generation vs material setup
- No shader compilation tests yet (GLSL validation)
- Track generation in `shared/track.ts` is monolithic — sub-functions could be extracted
- Client-side `generateTrack()` fallback duplicates server logic (intentional for offline dev)
- Weather multiplier was moved from `applyWeather()` to sky loop — `applyWeather` no longer touches sun/ambient intensity directly
- Light post system has per-biome special cases via string matching on model filename

## Future: Car Physics (Planned)

Goal: `/practice.html?seed=N&hour=H&weather=W` → single-player free roam

**Available assets:**
- Kenney car GLBs with separate wheel models (front/back, different styles)
- Need to check if wheel bones are rigged for steering/suspension animation

**Architecture considerations:**
- Physics engine: cannon-es or Rapier (WASM-based, fast)
- Vehicle controller: separate from rendering
- Extensible for future: multiple cars, tuning, garage, upgrades
- Terrain height sampling via existing `TerrainSampler`
- Sound: Web Audio API for engine RPM, tire skids

See `RESEARCH_CAR_PHYSICS.md` for detailed research.
