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

## Car Physics

### Practice Mode
`/practice.html?seed=N` — single-player free roam with arcade car physics.

### Architecture
- **Engine**: cannon-es `RaycastVehicle` (not `RigidVehicle` — RaycastVehicle is better for racing)
- **World**: SAPBroadphase, 120Hz physics step, solver.iterations=10
- **Terrain**: `CANNON.Heightfield` built from `TerrainSampler.getHeight()` at 128×128 resolution
- **Chassis**: Single `Box` shape with lowered center of mass (shape offset -0.1 on Y)
- **Wheels**: KINEMATIC bodies with `collisionFilterGroup=0`, synced via `postStep` listener
- **Steering**: Ackermann geometry (left/right wheels at different angles), smooth interpolation
- **Engine**: Negative force = forward (cannon-es Z-forward convention), rear-wheel drive only
- **Materials**: `wheelMaterial` + `groundMaterial` via `ContactMaterial` (friction 0.5)

### Files
| File | Description |
|------|-------------|
| `src/client/vehicle/types.ts` | `CarConfig`, `VehicleState`, `VehicleInput`, presets (RACE_CAR, SEDAN_CAR) |
| `src/client/vehicle/VehicleController.ts` | cannon-es physics, input handling, visual sync |
| `src/client/vehicle/index.ts` | barrel export |
| `src/client/practice.ts` | Scene setup, keyboard input, chase camera, main loop |
| `practice.html` | HUD (speed/gear/RPM), entry point |

### Car Configs
| Preset | Mass | Engine Force | Max Speed | Wheel Radius | Friction Slip | Roll Influence |
|--------|------|-------------|-----------|-------------|-------------|----------------|
| RACE_CAR | 150 | 1200 | 55 m/s (~200 km/h) | 0.3 | 1.4 | 0.4 |
| SEDAN_CAR | 200 | 1000 | 45 m/s (~160 km/h) | 0.3 | 1.2 | 0.5 |

### Controls
| Key | Action |
|-----|--------|
| W / ↑ | Accelerate |
| S / ↓ | Brake / Reverse |
| A / ← | Steer left |
| D / → | Steer right |
| Space | Handbrake |
| R | Reset car to spawn |

### Cannon-es Gotchas
- **Heightfield offset must be `(-halfSize, 0, +halfSize)`** after `-PI/2` X rotation
- **`type: CANNON.Body.STATIC` must be set explicitly** for heightfield collision
- **Engine force sign**: negative = forward with Z-forward axis convention
- **Safety net threshold**: only teleport if >5m below expected terrain height
- **solver.iterations**: accessed via `(world.solver as any).iterations = 10` due to missing type

### Car Model Dimensions (`race.glb`)
- Body: 1.2m wide × 0.63m tall × 2.56m long
- Wheel radius: ~0.3m, track width: ~0.7m (±0.35m), wheelbase: ~1.5m
- Separate wheel meshes named `wheel-front-left`, `wheel-front-right`, `wheel-back-left`, `wheel-back-right`

### Future
- [ ] Physics unit tests (sphere drop, stability, acceleration, steering response)
- [ ] Engine sound via Web Audio API
- [ ] Multiple car selection
- [ ] Tuning/garage/upgrades system

### Car Physics Research

Based on analysis of 4 working implementations cloned to `/tmp/`:

#### 1. pmndrs/cannon-es (official example)
- `examples/raycast_vehicle.html` — the reference
- RaycastVehicle + Heightfield (64×64), SAPBroadphase
- mass:150, engineForce:±1000, frictionSlip:1.4, rollInfluence:0.01
- KINEMATIC wheel bodies, ContactMaterial friction:0.3
- Heightfield: `(-sizeX*elSize/2, -1, +sizeZ*elSize/2)`, rotation -PI/2

#### 2. tomo0613/offroadJS_v2 (real offroad game)
- `src/vehicle/Vehicle.ts` — the gold standard for RaycastVehicle tuning
- mass:30, engineForce:220, frictionSlip:1.1, rollInfluence:0.6
- **forwardAcceleration:0.5, sideAcceleration:1.0** (critical tire response)
- **customSlidingRotationalSpeed:-30** (correct sliding wheel spin)
- **maxSuspensionForce:MAX_VALUE** (never cap suspension)
- Ackermann steering, torque vectoring, 120Hz physics
- Brake rear wheels only, 50/50 torque split
- Chassis: compound shapes with lowered CoM

#### 3. cconsta1/threejs_car_demo (Mario Kart style)
- Uses `RigidVehicle` (not RaycastVehicle) — simpler, good for arcade
- mass:16, maxForce:65, solver.iterations:10, `world.fixedStep()`
- Compound chassis: main box + nose + bumper + engine + wing
- shapeOffsets[0] lowered 0.2 for CoM, allowSleep=false
- linearDamping:0.25, angularDamping:0.7

#### 4. mslee98/cannon_car (tutorial)
- RigidVehicle + Heightfield (64×64, elSize~4.7m)
- mass:150, wide axle (7 units)
- Heightfield: `(-(sizeX-1)*elSize/2, -15, +(sizeZ-1)*elSize/2)`, -PI/2

#### Why Our First Attempt Failed
1. **Mass 800** — tank, not a car. force/mass ratio was 3.5 m/s² vs offroadJS's 7.3
2. **frictionSlip 3.5** — wheels lost grip at slightest turn → wobbling
3. **rollInfluence 0.01** — body didn't affect steering → disconnected feel
4. **damping 4.5/2.5** — over-damped compression → oscillation
5. **Missing forwardAcceleration/sideAcceleration** — tire response was wrong
6. **Missing customSlidingRotationalSpeed** — erratic wheel behavior
7. **60Hz physics** — too coarse for stable suspension
8. **No solver.iterations** — sloppy collision resolution
9. **No angularDamping** — uncontrollable spin
10. **Safety net at 1m** — fought physics every frame

#### The Correct Pattern
```
World: SAPBroadphase, gravity -9.82, defaultContactMaterial.friction 0.001,
       solver.iterations 10, step at 120Hz

RaycastVehicle: mass 30-150, angularDamping 0.5, linearDamping 0.01,
               engineForce/mass ratio ~5-10 m/s² for arcade

Wheel: stiffness 25-35, restLength 0.3, maxSuspensionForce MAX_VALUE,
       frictionSlip 1.0-1.5, damping 2/2, rollInfluence 0.3-0.6,
       forwardAcceleration 0.5, sideAcceleration 1.0,
       customSlidingRotationalSpeed -30

ContactMaterial (wheel↔ground): friction 0.3-1.0, restitution 0

Engine: negative force = forward, rear-wheel drive only
Steering: Ackermann geometry, smooth interpolation
Visuals: postStep listener → updateWheelTransform → copy to KINEMATIC bodies
```

Full notes also in `RESEARCH_CAR_PHYSICS.md` (original) and `RESEARCH_CAR_PHYSICS_V2.md` (detailed).

---

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

See [Car Physics Research](#car-physics-research) below for detailed analysis of working implementations.
