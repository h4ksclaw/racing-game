# Racing Game — Project Documentation

## Overview

A browser-based procedural racing game built with **Three.js** + **TypeScript**. Tracks are generated using seeded PRNGs and rendered with custom GLSL shaders and instanced meshes. Features include 6 biomes, dynamic weather, day/night cycle, procedural houses, guardrails, and arcade car physics.

**Philosophy:** YAGNI, KISS, DRY. Features built for testing/development are real features.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Browser (Client)                          │
│                                                              │
│  practice.ts ──► buildWorld() ──► Three.js Scene             │
│  track.ts (viewer)                                           │
│       │                                                      │
│       ├──── road.ts ──────────► road mesh (instanced)        │
│       ├──── terrain.ts ───────► heightmap (GLSL shader)      │
│       ├──── scenery.ts ───────► trees, rocks, grass, lights  │
│       ├──── buildings.ts ──────► procedural houses            │
│       ├──── sky.ts ───────────► sky dome, sun, stars         │
│       ├──── clouds.ts ────────► cloud layer                  │
│       ├──── weather.ts ───────► rain/snow/fog                │
│       ├──── biomes.ts ────────► biome config selection       │
│       └──── effects.ts ───────► bloom post-processing        │
│                                                              │
│  vehicle/ ──► CarModel.ts + VehicleController.ts             │
│    (custom arcade physics, no external physics engine)        │
└──────────────────────────────────────────────────────────────┘
```

## Pages

| Page | Entry Point | Description |
|------|------------|-------------|
| `/` | `pages/index.html` → `src/client/track.ts` | Track viewer with flyover camera |
| `/practice.html` | `src/client/practice.ts` | Free-roam driving with chase/orbit camera |
| `/physics-debug.html` | `src/client/debug-physics.ts` | Physics tuning page with gauges and graphs |

## Source Files

### Shared (`src/shared/`)
| File | Lines | Description |
|------|-------|-------------|
| `track.ts` | ~880 | Pure-math procedural track generation. PRNG, noise, spline, sampling, scenery placement. No Three.js dependency. |

### Client (`src/client/`)
| File | Lines | Description |
|------|-------|-------------|
| `scene.ts` | ~43 | Central mutable state object shared across all modules. |
| `world.ts` | ~312 | `buildWorld()` — orchestrates terrain, road, sky, weather, scenery, effects. Used by practice.ts. |
| `track.ts` | ~252 | Track viewer entry point. Loads track, builds scene, flyover camera. |
| `road.ts` | ~764 | Road mesh: asphalt, kerbs, shoulders, concrete slabs, center line, start/finish checker. |
| `terrain.ts` | ~700 | Heightmap terrain with custom GLSL shader. 7-layer blend based on height/slope/road distance. |
| `buildings.ts` | ~352 | Procedural house generation along roads. Per-biome styles. |
| `biomes.ts` | ~530 | 6 biome configurations. Colors, textures, tints, trees, grass, guardrails, houses, fog, sky. |
| `scenery.ts` | ~586 | GLB model loading, instanced scenery placement (trees, rocks, grass), guardrails. |
| `sky.ts` | ~399 | Sky dome, 14 time-of-day keyframes, sun position, stars, fog. |
| `clouds.ts` | ~43 | Cloud layer (animated noise-based plane). |
| `weather.ts` | ~479 | Weather system: 6 types (clear/cloudy/rain/heavy_rain/fog/snow), particles, wetness, tint shifts. |
| `effects.ts` | ~46 | UnrealBloom post-processing with per-object bloom control. |
| `utils.ts` | ~41 | Shared types (V3, WeatherType, TimeKeyframe), smoothstep utility. |
| `procedural-scenery.ts` | ~437 | Procedural geometry generators for trees, rocks, grass (fallback when no GLB models). |

### Vehicle Physics (`src/client/vehicle/`)
| File | Lines | Description |
|------|-------|-------------|
| `types.ts` | ~292 | `CarConfig`, `VehicleState`, `VehicleInput`, presets (RACE_CAR, SEDAN_CAR). |
| `CarModel.ts` | ~405 | `buildCarModel()` factory — Engine, Gearbox, Brakes, TireModel, DragModel. Custom arcade physics. |
| `VehicleController.ts` | ~342 | Integrates CarModel with Three.js visuals. Input handling, terrain following, visual sync. |
| `index.ts` | ~17 | Barrel exports. |

### Server (`src/server/`)
| File | Lines | Description |
|------|-------|-------------|
| `index.ts` | ~135 | Express server. `/api/track?seed=N` generates track data. Serves static builds. |

## Car Physics

Custom arcade physics — no external physics engine (cannon-es was removed). Built from composable models:

### Components
| Model | Responsibility |
|-------|---------------|
| `Engine` | RPM tracking, torque curve, idle, rev limiter, engine braking |
| `Gearbox` | 6-speed automatic, shift thresholds from gear ratios |
| `Brakes` | Braking force, handbrake (rear-biased) |
| `TireModel` | Grip, lateral slip, handbrake drift |
| `DragModel` | Rolling resistance (linear) + aero drag (quadratic) |

### Car Configs
| Preset | Mass | Max Engine Force | Top Speed | Gears | Notes |
|--------|------|-----------------|-----------|-------|-------|
| RACE_CAR | 800 | 8500 | ~55 m/s (200 km/h) | 6 | High grip, light, responsive |
| SEDAN_CAR | 1200 | 7000 | ~45 m/s (160 km/h) | 6 | Heavier, more body roll |

### Controls
| Key | Action |
|-----|--------|
| W / ↑ | Accelerate |
| S / ↓ | Brake / Reverse |
| A / ← | Steer left |
| D / → | Steer right |
| Space | Handbrake |
| R | Reset to nearest track point |

### Physics Debug Page
`/physics-debug.html` — standalone page with real-time gauges (speed, RPM, gear, forces), rolling-window graphs (speed vs time, RPM vs time), torque curve visualization, and on-screen controls (throttle/brake/steer sliders, car selector). No world loading required.

## Biomes (6 total)
| Biome | Character |
|-------|-----------|
| Alpine Meadow | Snowy mountains, pine trees, cool tones, no grass |
| Autumn Woods | Orange/brown palette, SpotLight posts, warm fog |
| Temperate Forest | Lush green, broadleaf trees, standard lighting |
| Desert Canyon | Sandy, sparse vegetation, warm tones, bright fog |
| Tropical Jungle | Dense green, palms, humid atmosphere |
| Rural Countryside | Gentle green, mixed trees, farmland, houses with farms |

Selection: `BIOMES[seed % BIOMES.length]`

## Weather (6 types)
| Type | Effects |
|------|---------|
| Clear | Full sun, no particles |
| Cloudy | Dimmed sun, cloud layer |
| Rain | Light particles, road wetness 0.5, darkened terrain |
| Heavy Rain | Heavy particles, road wetness 1.0, very dark, fog |
| Fog | Dense fog (near=50, far=400), dim lighting |
| Snow | Snow particles, terrain brightening, snow overlay on road |

## Day/Night Cycle
- 14 time keyframes (hour 0–24) with interpolated colors/intensities
- Sun position from elevation angle
- Street lights activate at night (PointLight or SpotLight)
- Bloom intensity scales with nightFactor
- Stars visible at night

## Testing

```bash
npm run test          # vitest watch mode
npm run test:run      # vitest single run
```

### Test Files (116 tests across 6 files)
| File | Tests | Coverage |
|------|-------|----------|
| `track.test.ts` | 14 | PRNG, determinism, sample structure |
| `biomes.test.ts` | 7 | Biome selection, seed mapping |
| `road.test.ts` | 10 | Road mesh geometry validation |
| `VehicleController.test.ts` | 50 | Full vehicle lifecycle, inputs, gears, forces |
| `biomes-validation.test.ts` | 11 | Biome config constraints, guardrails, houses |
| `vehicle-edge-cases.test.ts` | 24 | Gear shifting, stability, endurance, edge cases |

## Development

### Commands
```bash
npm run dev          # Vite dev server
npm run dev:server   # Express API server
npm run dev:full     # Both + Cloudflare tunnel
npm run build        # tsc + vite build
npm run lint         # biome check
npm run lint:fix     # biome check --write
npm run typecheck    # tsc --noEmit
npm run test         # vitest (watch mode)
npm run test:run     # vitest (single run)
npm run check        # tsc + biome + knip (full check)
```

### Code Quality
- **TypeScript**: strict mode with `noUnusedLocals` and `noUnusedParameters`
- **Biome**: formatter + linter
- **Knip**: dead code / unused dependency detection
- **Vitest**: unit tests
- **Husky + lint-staged**: pre-commit hooks (biome formatting)
- **GitHub Actions**: typecheck, lint, knip, tests, build, Docker

## Tech Debt
- `road.ts` (~764 lines) and `terrain.ts` (~700 lines) are large — could split mesh generation vs material setup
- No GLSL shader compilation tests
- Track generation in `shared/track.ts` is monolithic (~880 lines)
- Client-side `generateTrack()` fallback duplicates server logic (intentional for offline dev)
- `scene.ts` uses `null as X | null` pattern (simple but not type-safe at init)
