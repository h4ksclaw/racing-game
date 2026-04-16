# Racing Game — Project Documentation

## Overview

A browser-based procedural racing game built with **Three.js** + **TypeScript** + **Lit**. Tracks are generated using seeded PRNGs and rendered with custom GLSL shaders and instanced meshes. Features include 6 biomes, dynamic weather, day/night cycle, procedural houses, guardrails, custom arcade car physics, and procedural engine sound synthesis.

**Philosophy:** YAGNI, KISS, DRY. Features built for testing/development are real features. No spaghetti code — modular, testable, OOP with clean boundaries.

## Architecture

```
                        practice.ts / track.ts / garage.ts
                                    │
                         ┌──────────┴──────────┐
                         ▼                     ▼
                   VehicleController      world.ts
                   (composition root)    (scene builder)
                    ┌────┼────┐
                    ▼    ▼    ▼
              Physics  Renderer  Audio
              (math)   (Three.js) (Web Audio)
                │
         ┌──────┼──────┐
         ▼      ▼      ▼
      Engine  Tires  Chassis
      Unit    Brakes  Terrain
      Gearbox Drag    Handler
```

### Data Flow (per frame)
```
VehicleInput → VehicleController.update()
  → VehiclePhysics.update(input, delta)
    → Engine.update(wheelSpeed, gearRatio, wheelRadius)
    → Gearbox.update(dt, engine, wheelSpeed)
    → TireModel.compute(velocities, steer)
    → Brakes.getForce(mass)
    → DragModel.getForce(speed)
    → TerrainHandler.sample(x, z, heading)
    → EngineTelemetry { rpm, gear, throttle, load, boost, grade, clutchEngaged }
  → VehicleRenderer.sync(position, rotation, wheels)
  → EngineAudio.update(telemetry, position)
  → AudioBus.updateListener(camera.position, forward)
```

### Module Hierarchy

**Sound Engine → Engine Module → Car → World**

- **Sound engine** (`audio/`) observes engine telemetry, renders audio. One-way data flow.
- **Engine module** (`vehicle/engine/`) computes power, RPM, load, boost. Swappable as a unit.
- **Car** (`vehicle/`) composes engine + chassis + suspension + aero. Has physics, renderer, audio.
- **World** (`world.ts`) builds the scene. Cars are added to it. Multiple cars supported.

### Key Design Principles

- **No circular dependencies**: configs.ts ← types.ts (configs imports nothing from vehicle)
- **Pure math physics**: VehiclePhysics has zero Three.js, zero DOM, zero audio
- **Pure rendering**: VehicleRenderer has zero physics, zero audio
- **Observer pattern for audio**: EngineAudio consumes EngineTelemetry, never modifies it
- **Swap-able engine units**: Change EngineSpec → different powerplant, same chassis
- **Sound follows engine**: Changing engine specs changes how it sounds automatically

## Directory Structure

```
src/client/
  vehicle/                    # Car physics, rendering, types
    configs.ts                # Spec types (EngineSpec, GearboxSpec, etc.) + car presets
    types.ts                  # Runtime types (VehicleState, EngineTelemetry, VehicleInput)
    VehicleController.ts      # Thin composition root (physics + renderer + audio)
    VehiclePhysics.ts         # Pure math simulation (no Three.js, no audio)
    VehicleRenderer.ts        # All Three.js code (model loading, markers, wheels, lights)
    CarModel.ts               # Backward-compat re-exports + buildCarModel() factory
    engine/
      Engine.ts               # RPM, torque curve, throttle, rev limiter
      Gearbox.ts              # Gear ratios, shift state machine, clutch simulation
      EngineUnit.ts           # Engine + Gearbox as one swap-able unit
    suspension/
      TireModel.ts            # Slip angles, lateral forces, grip circle
      Brakes.ts               # g-based deceleration, handbrake
    aero/
      DragModel.ts            # Rolling resistance + aerodynamic drag
    chassis/
      Chassis.ts              # Mass, CG, suspension parameters
    world/
      TerrainHandler.ts       # Terrain height, normals, pitch/roll, road boundaries
  audio/                      # Procedural engine sound synthesis
    audio-types.ts            # EngineSoundConfig, HarmonicDef, NoiseConfig, ExhaustSystem
    EngineAudio.ts            # Additive harmonics + noise + distortion + reverb + spatial
    AudioBus.ts               # Shared AudioContext singleton + listener position
    audio-profiles.ts         # Sound presets + deriveSoundConfig() from engine specs
  ui/                         # Lit Web Components (shared theme library)
    theme.ts                  # CSS custom properties (h4ks.com palette)
    *.ts                      # 17 component files (rpm-bar, speed-display, minimap, etc.)
    garage-store.ts           # localStorage persistence for vehicle tuning
  world.ts                    # buildWorld() — orchestrates terrain, road, sky, weather, scenery
  practice.ts                 # Free-roam driving with chase/orbit camera + engine audio
  track.ts                    # Track viewer with flyover camera
  garage.ts                   # Vehicle tuning garage with 3D model viewer
  road.ts, terrain.ts, sky.ts, weather.ts, scenery.ts, etc.
```

## Pages

| Page | Entry Point | Description |
|------|------------|-------------|
| `/` | `track.ts` | Track viewer with flyover camera |
| `/practice.html` | `practice.ts` | Free-roam driving with engine audio, chase/orbit camera |
| `/garage.html` | `garage.ts` | Vehicle tuning garage with 3D model viewer |
| `/physics-debug.html` | `debug-physics.ts` | Physics tuning page with gauges and graphs |

## Audio System

### Architecture
- **Procedural synthesis** — no audio samples needed, all generated from engine specs
- **Hybrid approach** — additive harmonics + filtered noise layers + WaveShaper distortion
- **Spatial audio** — HRTF PannerNode per car, distance attenuation, head shadowing
- **Multi-car support** — each car = one EngineAudio instance, shared AudioContext

### Sound Chain
```
Harmonic Oscillators ─┐
  (firing freq × N)   │
Noise Layers (4) ─────┤
  exhaust, intake,    ├──► WaveShaper ──► Dry/Wet Split ──► Master Gain ──► PannerNode ──► Analyser ──► Output
  mechanical,          │                     │
  valvetrain           │              Convolver
                       │              (room reverb)
Special Effects ───────┘
  misfire, backfire, wastegate BOV
```

### Key Parameters
- **Firing frequency**: `f0 = (RPM / 60) × (cylinders / stroke)` for 4-stroke
- **Load shapes sound**: high load = bass boost + warmth; coasting = thin
- **Turbo whistle**: dedicated sine oscillator 2.5-5.5kHz, Q=15, ramp with boost
- **Misfire**: 3-layer noise blast (air burst + LF thump + HF crackle) + volume dip
- **BOV**: descending bandpass sweep 2000→400 Hz noise burst

### Sound Profiles
| Profile | Cylinders | Character |
|---------|-----------|-----------|
| AE86 Trueno | 4, NA | 8 harmonics, warm midrange, moderate distortion |
| Race Car | 4, NA | Aggressive, louder, higher distortion |
| Sedan | 4, NA | Muted, low distortion, quiet |

Profiles are derived from engine specs via `deriveSoundConfig()` or linked directly in CarConfig.

## Vehicle Physics

Custom arcade physics — no external physics engine. Composable OOP modules:

### Subsystems
| Module | Responsibility |
|--------|---------------|
| `Engine` | RPM tracking, torque curve interpolation, idle, rev limiter, engine braking |
| `Gearbox` | Shift state machine, auto-upshift/downshift, clutch simulation |
| `EngineUnit` | Engine + Gearbox as one swap-able powerplant |
| `TireModel` | Slip angles, lateral forces, grip circle, peak friction |
| `Brakes` | g-based deceleration, handbrake with rear grip reduction |
| `DragModel` | Rolling resistance (linear) + aerodynamic drag (quadratic) |
| `Chassis` | Mass, CG position, yaw inertia |
| `TerrainHandler` | Terrain height, surface normals, pitch/roll, road boundaries |

### Car Configs
| Preset | Mass | Torque | Top Speed | Gears | Notes |
|--------|------|--------|-----------|-------|-------|
| RACE_CAR | 150 kg | 50 Nm | ~55 m/s | 6 | Light arcade car |
| SEDAN_CAR | 200 kg | 35 Nm | ~45 m/s | 6 | Heavier, stable |
| SPORTS_CAR | 1000 kg | 145 Nm | ~200 km/h | 5 | AE86 Trueno, marker-based auto-derivation |

### AE86 Trueno Physics
- 1000 kg, 145 Nm torque, 5-speed, 80000/75000 N/rad cornering stiffness
- Realistic torque curve: 0.3 @ 850 RPM → 1.0 @ 4800 RPM → 0.85 @ 7600 RPM
- Weight distribution: 53% front
- Marker-based auto-derivation from GLB: PhysicsMarker + 4 WheelRig markers

### Engine Telemetry (data flow to audio + UI)
```typescript
interface EngineTelemetry {
  rpm: number;           // Current engine RPM
  gear: number;          // 0-indexed gear (0 = 1st)
  displayGear: number;   // 1-indexed, -1 for reverse
  throttle: number;      // 0-1
  load: number;          // 0-1 (engineForce / maxEngineForce)
  boost: number;         // 0-1 (simulated for turbo engines)
  speed: number;         // m/s
  isShifting: boolean;   // Gearbox mid-shift
  revLimited: boolean;   // RPM at maxRPM
  isTurbo: boolean;      // Engine has turbo
  grade: number;         // Road grade (radians, + = uphill)
  clutchEngaged: boolean; // Clutch fully engaged (not shifting)
}
```

## UI Components (Lit Web Components)

17 components in shared theme library with h4ks.com palette:
- **Primary**: `#5c9eff` (blue) | **Secondary**: `#ff8c4b` (orange) | **Background**: `#11131c` (navy)
- No emojis in UI. No experimentalDecorators — uses `declare` keyword for reactive properties.
- `pointer-events: none` on HUD containers; specific interactive elements get `pointer-events: auto`

Key components: `rpm-bar`, `speed-display`, `gear-strip`, `steer-indicator`, `pedal-bars`,
`session-badge`, `speed-trap`, `race-minimap`, `race-toast`, `loading-screen`,
`controls-help`, `settings-panel`, `damage-bar`, `tire-temps`, `car-nameplate`,
`lap-timer`, `system-bar`, `world-controls`, `control-panel`.

### Garage
- `garage-store.ts` — localStorage persistence for vehicle tuning overrides
- 3D model viewer, collapsible tuning sidebar, torque curve canvas
- Key: `"racing-garage-custom"`, stores `TunableConfig`

## Testing

```bash
npm run test          # vitest watch mode
npm run test:run      # vitest single run (167 tests)
```

### Test Files (167 tests across 8 files)
| File | Tests | Coverage |
|------|-------|----------|
| `track.test.ts` | 14 | PRNG, determinism, sample structure |
| `biomes.test.ts` | 7 | Biome selection, seed mapping |
| `road.test.ts` | 10 | Road mesh geometry validation |
| `VehicleController.test.ts` | 50 | Full vehicle lifecycle, inputs, gears, forces |
| `vehicle-edge-cases.test.ts` | 30 | Gear shifting, stability, endurance, edge cases |
| `biomes-validation.test.ts` | 11 | Biome config constraints, guardrails, houses |
| `ui.test.ts` | 36 | Lit component rendering, properties, themes |
| `audio.test.ts` | 9 | AudioBus singleton, deriveSoundConfig, EXHAUST_SYSTEMS |

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
- **Biome**: 0 errors, 0 warnings, 0 suggestions enforced
- **Knip**: zero dead code / unused dependencies
- **Vitest**: 167 tests across 8 files
- **Husky + lint-staged**: pre-commit hooks (biome formatting)
- **GitHub Actions**: typecheck, lint, knip, tests, build, Docker

### Constraints
- Tabs, double quotes, semicolons, 100 char width
- No `any`, no `forEach`, no `!` non-null assertions
- No `experimentalDecorators`
- No emojis in UI

## Biomes (6 total)
| Biome | Character |
|-------|-----------|
| Alpine Meadow | Snowy mountains, pine trees, cool tones |
| Autumn Woods | Orange/brown palette, warm fog |
| Temperate Forest | Lush green, broadleaf trees |
| Desert Canyon | Sandy, sparse vegetation, warm tones |
| Tropical Jungle | Dense green, palms, humid atmosphere |
| Rural Countryside | Gentle green, mixed trees, farmland, houses |

## Tech Debt
- `road.ts` (~764 lines) and `terrain.ts` (~700 lines) are large — could split mesh generation vs material setup
- No GLSL shader compilation tests
- Track generation in `shared/track.ts` is monolithic (~880 lines)
- CarModel.ts still has `buildCarModel()` for backward compatibility — could remove when tests migrate
- EngineAudio not yet tested with real Web Audio (tests mock AudioContext)
