# Car Physics Research — Working Implementations

## Repos Studied

### 1. pmndrs/cannon-es (official example)
- **File**: `examples/raycast_vehicle.html`
- **Vehicle type**: `RaycastVehicle`
- **Terrain**: `Heightfield` (64×64, 100m world, elementSize ~1.56m)
- **Key params**:
  - mass: 150, engineForce: ±1000, steerAngle: ±0.5
  - suspensionStiffness: 30, restLength: 0.3, maxTravel: 0.3
  - frictionSlip: 1.4, dampingRelaxation: 2.3, dampingCompression: 4.4
  - maxSuspensionForce: 100000, rollInfluence: 0.01
  - axleLocal: (0,0,1), directionLocal: (0,-1,0)
- **World**: SAPBroadphase, gravity -10, defaultContactMaterial.friction = 0
- **Materials**: wheelMaterial + groundMaterial via ContactMaterial (friction: 0.3, stiffness: 1e6)
- **Wheels**: KINEMATIC bodies with collisionFilterGroup=0, synced in postStep
- **Engine**: NEGATIVE force = forward (Z-forward axis)
- **Heightfield position**: `(-sizeX*elSize/2, -1, +sizeZ*elSize/2)`, rotation -PI/2

### 2. tomo0613/offroadJS_v2 (real offroad game)
- **File**: `src/vehicle/Vehicle.ts`, `src/config.ts`
- **Vehicle type**: `RaycastVehicle` with sophisticated torque vectoring
- **Key params**:
  - mass: 30, maxEngineForce: 220, maxBrakeForce: 22
  - wheelRadius: 0.4, suspensionStiffness: 25, restLength: 0.3
  - maxSuspensionForce: MAX_VALUE (!)
  - frictionSlip: 1.1, rollInfluence: 0.6
  - dampingCompression: 2, dampingRelaxation: 2
  - forwardAcceleration: 1/2, sideAcceleration: 1
  - customSlidingRotationalSpeed: -30
  - steeringSpeed: 0.02 (smooth), maxSteeringAngle: 0.7
- **Features**:
  - Ackermann steering geometry
  - Torque vectoring (distributes torque to wheels with grip)
  - Wheel slip detection via `wheelInfo.isInContact && !wheelInfo.sliding`
  - 50/50 torque split by default
  - Brake only on rear wheels
- **World**: SAPBroadphase, defaultContactMaterial.friction: 0.001
  - ContactMaterial general→general: friction 1e-3
  - ContactMaterial general→lowFriction: friction 0, stiffness 1e8
- **Physics**: 120Hz (`physicsFrameRate: 120`), `world.step(physicsFrameTime, delta)`
- **Chassis**: Two compound shapes (base + top), offset for center of mass
- **Wheels**: Updated in `postStep` listener via `worldTransform`
- **Camera**: Separate CameraHandler with cinematic/chase modes

### 3. cconsta1/threejs_car_demo (Mario Kart style)
- **File**: `src/Experience/World/SimpleCarPhysics.js`
- **Vehicle type**: `RigidVehicle` (NOT RaycastVehicle!)
- **Key params**:
  - mass: 16, maxForce: 65
  - wheelRadius: 0.52, wheelMass: 1.0
  - linearDamping: 0.25, angularDamping: 0.7
  - ContactMaterial: friction 1.0, restitution 0.01
- **Chassis**: Compound shapes — main box + nose + bumper + engine block + wing
  - shapeOffsets[0] lowered by 0.2 for lower center of mass
  - allowSleep = false
- **Wheels**: Sphere colliders, own bodies with mass=1, damping
- **World**: SAPBroadphase, solver.iterations = 10, `world.fixedStep()` (no delta param!)
- **Features**: Jump, turbo boost, color change, ground detection via raycast

### 4. mslee98/cannon_car (Korean tutorial)
- **File**: `src/main.js`
- **Vehicle type**: `RigidVehicle` (NOT RaycastVehicle!)
- **Key params**:
  - mass: 150, chassis: Box(2.5, 0.5, 4), wheels: Sphere(1.1)
  - axisWidth: 7 (wide!)
- **Heightfield**: 64×64, elementSize: 300/64 ≈ 4.7m
  - position: (-(sizeX-1)*elSize/2, -15, +(sizeZ-1)*elSize/2)
  - rotation: -PI/2
- **Uses**: cannon-es-debugger for wireframe visualization

## Key Lessons

### Why Our Car Was Broken

1. **Mass too high**: 800kg with only 2800N engine force → sluggish. offroadJS uses 30kg/220N.
   The ratio matters more than absolute values: offroadJS = 7.3 m/s², ours = 3.5 m/s²

2. **frictionSlip too high**: 3.5 vs offroadJS's 1.1. High frictionSlip means wheels lose grip
   at higher slip ratios → more sliding/instability. Lower = more forgiving.

3. **rollInfluence too low**: 0.01 vs 0.6. This controls how much body roll affects steering.
   0.01 means the car barely reacts to body lean → feels disconnected.

4. **No damping tuning**: We used cannon-es defaults. offroadJS carefully sets compression=2,
   relaxation=2. We had 4.5/2.5 (over-damped on compression).

5. **No forwardAcceleration/sideAcceleration**: These are crucial RaycastVehicle params that
   control how the tire responds to forces in different directions.

6. **No customSlidingRotationalSpeed**: -30 makes the wheel spin correctly when sliding.
   Without it, wheels may behave erratically.

7. **Variable timestep**: We used `world.step(1/60, delta, 3)` with variable delta.
   offroadJS uses 120Hz fixed step. Mario Kart demo uses `world.fixedStep()`.

8. **No solver iterations**: We never set `solver.iterations`. Mario Kart sets 10.

9. **No angular damping on chassis**: Without this, the car can spin uncontrollably.

10. **Safety net fighting physics**: Our terrain correction was too aggressive, creating
    oscillation. Should only trigger for extreme cases (>2m below).

### The Correct Pattern (from offroadJS)

```
World:
  - SAPBroadphase
  - gravity: (0, -9.82, 0)
  - defaultContactMaterial.friction: 0.001 (near zero)
  - solver.iterations: 10
  - step at 120Hz or use fixedStep()

RaycastVehicle:
  - chassisBody.mass: 30-150 (match engine force proportionally)
  - chassisBody.angularDamping: 0.4-0.7
  - chassisBody.linearDamping: 0.1-0.3
  - engineForce / mass ratio: ~5-10 m/s² for arcade feel

Wheel config:
  - suspensionStiffness: 25-35
  - suspensionRestLength: 0.3
  - maxSuspensionForce: MAX_VALUE or very large
  - maxSuspensionTravel: 0.3
  - frictionSlip: 1.0-1.5
  - dampingCompression: 2
  - dampingRelaxation: 2
  - rollInfluence: 0.3-0.6
  - forwardAcceleration: 0.5
  - sideAcceleration: 1.0
  - customSlidingRotationalSpeed: -30

ContactMaterial (wheel↔ground):
  - friction: 0.3-1.0
  - restitution: 0

Engine:
  - NEGATIVE force = forward (Z-forward axis convention)
  - Apply to rear wheels only (indices 2,3)
  - Brake on rear wheels only
  - Ackermann steering on front wheels (indices 0,1)

Visual sync:
  - postStep listener
  - updateWheelTransform(i) then copy worldTransform.position/quaternion
  - Or: KINEMATIC wheel bodies with collisionFilterGroup=0
```

### Car Model Dimensions

Our `race.glb` (Kenney car kit):
- Body: 1.2m wide × 0.63m tall × 2.56m long
- Wheel radius: ~0.3m
- Wheel track width: ~0.7m (±0.35m from center)
- Wheelbase: ~1.5m (front at z=+0.64, rear at z=-0.88)

These are approximately correct for the physics config. The visual-to-physics
mapping is reasonable.
