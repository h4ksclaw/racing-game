# System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER                               │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │  INPUT   │→ │ CONTROLS │→ │ VEHICLE  │→ │   PHYSICS   │  │
│  │ Keyboard │  │ Steering │  │ Forces   │  │  cannon-es  │  │
│  │ Gamepad  │  │ Throttle │  │ Brakes   │  │ RaycastVeh │  │
│  │ Touch    │  │ Drift    │  │ Drift    │  │ Collision  │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────┬──────┘  │
│                                                      │         │
│                                                      ▼         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │  HUD     │← │   UI     │← │   GAME   │← │   RENDER   │  │
│  │ Speed    │  │  Lobby   │  │  Loop    │  │  Three.js  │  │
│  │ Position │  │  Menu    │  │  State   │  │  Camera    │  │
│  │ Lap      │  │ Results  │  │  Events  │  │  Effects   │  │
│  └──────────┘  └──────────┘  └─────┬────┘  └────────────┘  │
│                                   │                          │
│                    ┌──────────────┼──────────────┐           │
│                    ▼              ▼              ▼           │
│              ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│              │  TRACK   │  │ AUDIO    │  │ NETWORK  │       │
│              │  Loader  │  │ Manager  │  │ Manager  │       │
│              │  Gates   │  │ Tone.js  │  │ PeerJS   │       │
│              └──────────┘  └──────────┘  └────┬─────┘       │
│                                               │               │
└───────────────────────────────────────────────┼───────────────┘
                                                │ P2P (WebRTC)
                                                │
┌───────────────────────────────────────────────┼───────────────┐
│                    EXPRESS SERVER              │               │
│                                               │               │
│  ┌─────────────────────────────────────────┐  │               │
│  │  Party Code API                         │  │               │
│  │  POST /api/party/create                │  │               │
│  │  POST /api/party/join                  │  │               │
│  │  GET  /api/party/:code                 │  │               │
│  └─────────────────────────────────────────┘  │               │
│                                               │               │
└───────────────────────────────────────────────┼───────────────┘
                                                │
                                                ▼
                                         ┌──────────────┐
                                         │ PeerJS Cloud │
                                         │ (signaling)  │
                                         └──────────────┘
```

## Module Dependency Graph

```
main.ts
├── Game.ts
│   ├── SceneManager.ts (Three.js scene, renderer, lights)
│   ├── PhysicsWorld.ts (cannon-es world, ground plane)
│   ├── Vehicle.ts (RaycastVehicle wrapper)
│   │   ├── VehicleControls.ts (input → forces)
│   │   └── VehicleCamera.ts (chase cam)
│   ├── TrackLoader.ts (GLB loading, colliders)
│   │   └── TrackGenerator.ts (procedural spline tracks)
│   ├── InputManager.ts (keyboard, gamepad, touch)
│   ├── AudioManager.ts (engine sound, SFX)
│   ├── SkidMarks.ts (canvas texture)
│   ├── ParticleSystem.ts (tire smoke)
│   └── NetworkManager.ts (PeerJS)
│       ├── HostRelay.ts (host-side relay)
│       └── ClientSync.ts (client interpolation)
├── HUD.ts (speed, position, lap)
├── Lobby.ts (create/join game)
└── Leaderboard.ts (race results)
```

## Data Flow Per Frame

```
1. INPUT    → keydown/keyup/gamepad polling → ControlsState
2. CONTROLS → ControlsState → VehicleControls.applyForces()
3. VEHICLE  → engine force, brake, steering → cannon-es WheelInfo
4. PHYSICS  → world.step(dt) → updates body positions/rotations
5. SYNC     → Vehicle.ts reads physics body → updates Three.js mesh
6. CAMERA   → VehicleCamera.update(carPosition, carQuaternion)
7. EFFECTS  → SkidMarks.draw(), Particles.emit() (if drifting)
8. AUDIO    → AudioManager.updateSpeed(vehicleSpeed)
9. NETWORK  → NetworkManager.broadcast(state) @ 20Hz
10. RENDER  → renderer.render(scene, camera)
```

## Game Loop Structure

```typescript
// Game.ts (simplified)
class Game {
  private clock = new THREE.Clock();
  private physicsAccumulator = 0;
  private readonly PHYSICS_STEP = 1 / 60;

  update() {
    const dt = Math.min(this.clock.getDelta(), 0.1); // cap at 100ms
    
    // Fixed timestep physics
    this.physicsAccumulator += dt;
    while (this.physicsAccumulator >= this.PHYSICS_STEP) {
      this.physicsWorld.step(this.PHYSICS_STEP);
      this.physicsAccumulator -= this.PHYSICS_STEP;
    }
    
    // Read physics → update visuals
    this.vehicle.syncFromPhysics();
    this.camera.update(this.vehicle.position, this.vehicle.quaternion);
    
    // Effects
    this.skidMarks.update(this.vehicle.wheels);
    this.particles.update(dt);
    this.audio.update(this.vehicle.speed);
    
    // Network (throttled to 20Hz internally)
    this.network.broadcast(this.vehicle.state);
    
    // Render
    this.renderer.render(this.scene, this.camera.camera);
  }
}
```

## State Management

**No framework.** Plain TypeScript classes with direct references.

- `Game` holds references to all subsystems
- `Vehicle` is the source of truth for car state (reads from cannon-es body)
- `InputManager` maintains a `ControlsState` object (frozen each frame)
- `NetworkManager` emits events for state updates from other players
- UI components (`HUD`, `Lobby`) read from `Game` state each frame

**Why no state management library?** Game state changes 60x/second. React state, Zustand, Redux — all add overhead for zero benefit in a game loop. Direct property access is fastest and simplest.
