# Car Physics Research & Architecture Plan

## Executive Summary

We need a vehicle physics system for `/practice.html` — single-player free roam on procedurally generated tracks. The system must be extensible (future: multiple cars, garage, tuning, upgrades) but start simple (YAGNI/KISS).

**Recommendation: cannon-es** — pure JS, lightweight, tree-shakeable, active maintenance, good Three.js ecosystem, built-in RaycastVehicle for car physics.

## Physics Engine Comparison

### cannon-es ⭐ Recommended
- **What:** Maintained fork of cannon.js, pure JavaScript physics engine
- **Pros:**
  - Zero dependencies, small bundle (~150KB gzipped)
  - Tree-shakeable ESM, TypeScript types included
  - **Built-in `RaycastVehicle`** — exactly what we need for cars
  - `cannon-es-debugger` for Three.js wireframe debugging
  - Simple API, well-documented
  - Active maintenance (pmndrs org — same as react-three-fiber)
  - `use-cannon` for React integration if ever needed
- **Cons:**
  - No WASM (pure JS) — slower than Rapier for complex scenes
  - Vehicle model is basic (no tire deformation, limited suspension presets)
  - No built-in terrain collider for heightmaps (need trimesh or heightfield)
- **Verdict:** Best fit. Simple, proven, does what we need. Performance fine for 1 car + terrain.

### ammo.js (Bullet)
- **What:** Direct C++ Bullet physics port via Emscripten (WASM)
- **Pros:**
  - Full Bullet feature set (mature, industry-proven)
  - WASM performance
  - Built-in `btRaycastVehicle`
  - Heightfield terrain support
- **Cons:**
  - Large WASM bundle (~500KB+)
  - Clunky JS API (C++ idioms leak through — `get_m_*`, manual memory management)
  - Less TypeScript friendly
  - No tree-shaking (monolithic)
  - Harder to debug
- **Verdict:** Overkill for now. Consider if we need advanced vehicle dynamics later.

### Rapier
- **What:** Rust-based physics engine compiled to WASM
- **Pros:**
  - Fastest WASM physics engine
  - Modern API, good TypeScript support
  - Active development
- **Cons:**
  - **No built-in vehicle controller** — would need custom implementation
  - Larger bundle than cannon-es
  - Heightfield support exists but less documented
- **Verdict:** Great engine but missing vehicle support makes it more work, not less.

## Available Car Models

### Kenney Racing Kit (already in project)
Location: `public/assets/kenney-car-kit/Models/GLB format/`

**Recommended starter cars:**
| Model | Style | Notes |
|-------|-------|-------|
| `race.glb` | Formula/open-wheel | 5 separate meshes: body + 4 wheels |
| `sedan.glb` | Standard sedan | Good for "normal" driving feel |
| `sedan-sports.glb` | Sports sedan | |
| `suv.glb` | SUV | Higher clearance |
| `race-future.glb` | Sci-fi racer | Fun alternative |
| `hatchback-sports.glb` | Hot hatch | Compact, nimble feel |

**Wheel models (separate):**
- `wheel-default.glb`, `wheel-racing.glb`, `wheel-dark.glb`
- Front/back variants: `wheel-tractor-dark-front.glb`, etc.

**Key finding from GLB analysis (race.glb):**
- 5 nodes: body + 4 wheels (front-left, front-right, back-left, back-right)
- Wheels are **separate meshes with translation offsets**, NOT bone-rigged
- Body dimensions: ~1.2m wide, ~0.63m tall, ~2.56m long (Kenney units)
- Wheel positions: ±0.35m X, 0.3m Y, ±0.64/0.88m Z
- Single colormap texture atlas (one material for all parts)
- **Perfect for us** — we can rotate wheel nodes directly for steering/spin
- No suspension bone rigging — we animate wheel Y position ourselves

**License:** Kenney assets are CC0 (public domain) for the racing kit.

### Other Free Car Models
- **Poly Haven:** CC0 cars (limited selection)
- **Sketchfab:** Search "CC0 car glb" — many low-poly options
- **Turbosquid:** Some free models, check license
- **Kenney.nl:** Additional car packs may be available

For now, Kenney Racing Kit is sufficient. We can add more later.

## Vehicle Physics Architecture

### Core Components

```
src/client/vehicle/
├── VehicleController.ts    # Main class — orchestrates everything
├── CarConfig.ts            # Car definition (stats, dimensions, tuning)
├── WheelController.ts      # Per-wheel: raycast, suspension, steering
├── Drivetrain.ts           # Engine, gears, torque curve
├── TireModel.ts            # Friction, slip, grip
├── SoundSystem.ts          # Engine RPM, tire sounds
└── types.ts                # Shared interfaces
```

### VehicleController (main class)

```typescript
interface VehicleController {
  // Physics body (cannon-es RigidBody)
  chassis: CANNON.Body;

  // Visual model (Three.js Group)
  model: THREE.Group;
  wheels: {
    mesh: THREE.Mesh;      // visual wheel
    body: CANNON.Body;     // physics wheel (RaycastVehicle)
    isFront: boolean;
  }[];

  // State
  speed: number;           // m/s
  rpm: number;
  gear: number;
  steeringAngle: number;
  throttle: number;
  brake: number;

  // Methods
  update(delta: number): void;
  reset(position: V3, rotation: number): void;
  dispose(): void;
}
```

### Physics: cannon-es RaycastVehicle

cannon-es has `CANNON.RaycastVehicle` built in. It works by casting rays downward from wheel positions to detect the ground, then applies suspension forces. This is exactly what we need.

Key parameters per wheel:
- **suspensionStiffness**: Spring constant (200-600 for cars)
- **suspensionRestLength**: Natural length (0.3-0.5m)
- **frictionSlip**: Tire grip (1.5-5.0)
- **dampingRelaxation**: Compression damping (2-5)
- **dampingCompression**: Rebound damping (3-5)
- **maxSuspensionForce**: Maximum spring force (100000)
- **rollInfluence**: How much the car leans in turns (0.01-0.1)
- **maxSuspensionTravel**: Maximum compression (0.3m)

### Terrain Integration

We have `TerrainSampler` in terrain.ts that provides `getHeight(x, z)`. Two approaches:

**Option A: Heightfield collider (recommended)**
- Convert our heightmap to a `CANNON.Heightfield`
- cannon-es supports this natively
- Efficient collision detection
- Need to convert our simplex noise heightmap to cannon-es format

**Option B: Trimesh collider**
- Convert terrain mesh geometry to `CANNON.Trimesh`
- More accurate but slower
- May have issues with raycasting for wheels

**Option C: Custom raycast**
- Skip terrain collider entirely
- Use our existing `TerrainSampler.getHeight()` for wheel ground detection
- Simpler, works with our procedural terrain directly
- Need to implement our own suspension forces
- **Actually this might be the cleanest approach** since we control the terrain

### Drivetrain Model

Simple but effective:
```
Engine RPM → Torque Curve → Gear Ratio → Wheel Torque → Force
```

- **Engine:** Simple torque curve (peak at ~4000-6000 RPM, drops off)
- **Gears:** 5-6 forward + 1 reverse, automatic shifting
- **Torque:** `engineTorque × gearRatio × finalDrive`
- **Speed limiter:** Optional, per-car
- **Rev limiter:** Hard cut at max RPM

```typescript
interface CarConfig {
  name: string;
  modelPath: string;
  mass: number;              // kg (1000-2000)
  engineForce: number;       // N (2000-5000)
  brakeForce: number;        // N (50-100)
  maxSteerAngle: number;     // rad (0.4-0.6)
  gears: number[];           // gear ratios
  maxRPM: number;
  idleRPM: number;
  // Wheel positions relative to chassis (from GLB)
  wheelPositions: { x: number; y: number; z: number }[];
  wheelBase: number;         // distance between axles
  trackWidth: number;        // distance between left/right wheels
}
```

### Tire Model

Keep it simple — don't need Pacejka magic formulas:
- **Lateral grip:** Proportional to `frictionSlip` and normal force
- **Longitudinal slip:** Difference between wheel rotation speed and ground speed
- **Drift detection:** When lateral force exceeds grip threshold → reduce grip → oversteer
- **Surface friction multiplier:**
  - Asphalt: 1.0
  - Grass: 0.5
  - Dirt: 0.6
  - Gravel: 0.4
  - Snow: 0.3

### Steering Model

Simplified Ackermann (don't need full geometric Ackermann):
- Low speed: Full steering angle (tight turns)
- High speed: Reduced steering angle (stability)
- `effectiveSteer = maxSteerAngle × (1 - speed / maxSpeed × 0.6)`
- This naturally limits turning at high speed

### Suspension Visual

Since Kenney models don't have bone rigging:
- Wheel mesh Y position = `suspensionLength - compression`
- Body roll: Slight rotation around forward axis based on lateral G-force
- Body pitch: Slight rotation around side axis based on acceleration/braking
- These are visual-only (physics handled by RaycastVehicle)

### Drag & Air Resistance

Simple formula: `F_drag = -0.5 × Cd × A × ρ × v²`
- Cd (drag coefficient): 0.3-0.4 for cars
- A (frontal area): ~2.2 m²
- ρ (air density): 1.225 kg/m³
- Or simplified: `F_drag = -dragCoeff × speed × speed`

### Sound System

**Architecture:**
```
SoundSystem.ts
├── EngineSound    # Procedural oscillator (Web Audio API)
├── TireSound      # Skid/screech when sliding
└── AmbientSound   # Wind, environment
```

**Engine Sound (procedural — no audio files needed):**
- Web Audio API oscillator + gain node
- Frequency maps to RPM: `freq = 80 + (rpm / maxRPM) * 400` Hz
- Add harmonics for richness (2nd, 3rd harmonic at lower volume)
- Add lowpass filter — cutoff frequency increases with RPM
- Load on throttle = louder + richer harmonics
- Gear shifts = brief frequency dip

**Tire Sound:**
- Noise buffer (white noise filtered)
- Volume proportional to lateral slip
- Pitch proportional to speed
- Only plays when wheel slip exceeds threshold

**Free Sound Resources (for future enhancement):**
- Freesound.org (CC0 section)
- OpenGameArt.org (car engine SFX)
- Kenney.nl (UI sounds, not engine sounds)

## Implementation Phases

### Phase 1: Minimum Viable Car (MVP)
**Goal:** Driveable car on terrain, keyboard controls, basic physics

1. Install cannon-es
2. Create `VehicleController` with cannon-es RaycastVehicle
3. Load Kenney race.glb, connect wheel meshes
4. Keyboard input: WASD/arrows (throttle, brake, steer)
5. Camera follow (chase cam behind car)
6. Use custom raycast against TerrainSampler for ground detection
7. Basic engine force + brake force
8. `/practice.html` page

### Phase 2: Polish
1. Multiple car configs (race, sedan, SUV)
2. Gear system with RPM-based auto-shift
3. Speed-dependent steering
4. Surface friction (road vs grass vs dirt)
5. Drift/skid detection
6. Suspension animation (wheel Y bounce)
7. Body roll/pitch visual
8. HUD (speedometer, RPM, gear)

### Phase 3: Sound & Feel
1. Procedural engine sound
2. Tire skid sounds
3. Camera smoothing and options (chase, cockpit, top-down)
4. Particle effects (tire smoke, dust)

### Phase 4: Extensibility (Future)
1. Car definition system (JSON configs)
2. Garage UI (select car, view stats)
3. Tuning/upgrades (engine, tires, suspension)
4. Multiple players (eventually)

## File Structure (Proposed)

```
src/client/vehicle/
├── index.ts              # Barrel export
├── types.ts              # VehicleState, CarConfig, WheelConfig interfaces
├── VehicleController.ts  # Main controller (physics + visual sync)
├── CarDefs.ts            # Car definitions (configs for each car model)
├── InputHandler.ts       # Keyboard/gamepad input → vehicle commands
├── ChaseCamera.ts        # Camera follow system
├── SoundSystem.ts        # Web Audio engine + tire sounds
└── constants.ts          # Physics constants, default values

practice.html             # Entry point for free roam
src/client/practice.ts    # Practice mode setup (loads track + spawns car)
```

## Key Design Decisions

1. **cannon-es over ammo.js/Rapier:** Simpler API, built-in RaycastVehicle, smaller bundle, pure JS (no WASM loading)
2. **Custom terrain raycast over heightfield collider:** Uses our existing TerrainSampler directly, avoids duplicating heightmap data
3. **Separate wheel meshes (not bone-rigged):** Kenney models have separate wheel nodes — we rotate them directly. Simpler and more controllable.
4. **Procedural engine sound over audio files:** No asset loading, works immediately, fully dynamic with RPM
5. **Config-driven car definitions:** Each car is a JSON-like config object — easy to add new cars, tuning, upgrades later
6. **Practice page IS the real feature:** YAGNI — what we build for testing is the actual game mode

## Cannon-es RaycastVehicle Example

```typescript
import * as CANNON from 'cannon-es';

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });

const chassisBody = new CANNON.Body({ mass: 1500 });
chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(1, 0.5, 2)));
world.addBody(chassisBody);

const vehicle = new CANNON.RaycastVehicle({
  chassisBody,
  indexRightAxis: 0,
  indexUpAxis: 1,
  indexForwardAxis: 2,
});

// Add wheels
const wheelOptions = {
  radius: 0.3,
  directionLocal: new CANNON.Vec3(0, -1, 0),
  suspensionStiffness: 30,
  suspensionRestLength: 0.3,
  frictionSlip: 1.4,
  dampingRelaxation: 2.3,
  dampingCompression: 4.4,
  maxSuspensionForce: 100000,
  rollInfluence: 0.01,
  axleLocal: new CANNON.Vec3(-1, 0, 0),
  chassisConnectionPointLocal: new CANNON.Vec3(0, 0, 0),
  maxSuspensionTravel: 0.3,
  customSlidingRotationalSpeed: -30,
  useCustomSlidingRotationalSpeed: true,
};

// Front wheels
vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3(-0.35, 0, 0.64) });
vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3(0.35, 0, 0.64) });
// Rear wheels (driven)
vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3(-0.35, 0, -0.88) });
vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3(0.35, 0, -0.88) });

vehicle.addToWorld(world);

// Per frame:
vehicle.applyEngineForce(2500, 2); // rear-left
vehicle.applyEngineForce(2500, 3); // rear-right
vehicle.setSteeringValue(steerAngle, 0);
vehicle.setSteeringValue(steerAngle, 1);
vehicle.setBrake(brakeForce, 2);
vehicle.setBrake(brakeForce, 3);

world.step(1/60, delta, 3);
```

## Terrain Collision Approach

Since we have `TerrainSampler.getHeight(x, z)`, we can implement a simple ground clamping approach:

```typescript
function updateWheelGroundContact(wheel: WheelState, terrain: TerrainSampler) {
  const groundY = terrain.getHeight(wheel.worldPos.x, wheel.worldPos.z);
  const suspensionLength = wheel.restLength;
  const penetration = (wheel.worldPos.y - groundY) - suspensionLength;

  if (penetration < 0) {
    // Wheel is in contact with ground
    const compression = -penetration;
    const force = compression * wheel.stiffness - wheel.velocity * wheel.damping;
    chassisBody.applyForce(
      new CANNON.Vec3(0, Math.min(force, wheel.maxForce), 0),
      wheel.connectionPoint
    );
  }
}
```

Or, if we use cannon-es's built-in RaycastVehicle with a static heightfield body, the vehicle handles this automatically. The tradeoff is duplicating heightmap data.

**Recommendation:** Start with the custom raycast approach (simpler, uses existing terrain). Switch to heightfield collider if we need better collision (walls, barriers) later.
