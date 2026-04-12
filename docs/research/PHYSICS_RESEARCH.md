# Physics Research — Car Physics, Drift Mechanics, cannon-es

## cannon-es RaycastVehicle Setup

### World Initialization

```typescript
import * as CANNON from 'cannon-es';

const world = new CANNON.World({
  gravity: new CANNON.Vec3(0, -9.82, 0),
});
world.defaultContactMaterial.friction = 0.3;
```

### Vehicle Creation

```typescript
const chassisShape = new CANNON.Box(new CANNON.Vec3(0.9, 0.3, 2.0));
const chassisBody = new CANNON.Body({ mass: 150 });
chassisBody.addShape(chassisShape);

const vehicle = new CANNON.RaycastVehicle({
  chassisBody,
  indexRightAxis: 0,    // X
  indexUpAxis: 1,       // Y
  indexForwardAxis: 2,  // Z
});

// Add 4 wheels
const wheelOptions = {
  radius: 0.35,
  directionLocal: new CANNON.Vec3(0, -1, 0),
  suspensionStiffness: 60,
  suspensionRestLength: 0.3,
  dampingCompression: 0.3,
  dampingRelaxation: 0.5,
  frictionSlip: 5.0,      // KEY: tire grip
  rollInfluence: 0.1,
  axleLocal: new CANNON.Vec3(-1, 0, 0),
  maxSuspensionTravel: 0.3,
  maxSuspensionForce: 100000,
  customSlidingRotationalSpeed: -30,
  useCustomSlidingRotationalSpeed: true,
};

// Positions: front-left, front-right, rear-left, rear-right
vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3(-0.8, 0, 1.2) });
vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3( 0.8, 0, 1.2) });
vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3(-0.8, 0, -1.0) });
vehicle.addWheel({ ...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3( 0.8, 0, -1.0) });

vehicle.addToWorld(world);
```

### Ground Plane

```typescript
const groundShape = new CANNON.Plane();
const groundBody = new CANNON.Body({ mass: 0 });
groundBody.addShape(groundShape);
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);
```

---

## Drift Mechanics — The frictionSlip Trick

### How It Works

The key insight from driftking: **drift is just reduced rear tire grip**.

```typescript
// Normal driving
const NORMAL_FRICTION = 5.0;
const DRIFT_FRICTION = 0.5;

// Each frame:
if (controls.handbrake) {
  // Reduce rear wheel grip
  vehicle.wheelInfos[2].frictionSlip = DRIFT_FRICTION; // rear-left
  vehicle.wheelInfos[3].frictionSlip = DRIFT_FRICTION; // rear-right
} else {
  // Restore grip
  vehicle.wheelInfos[2].frictionSlip = NORMAL_FRICTION;
  vehicle.wheelInfos[3].frictionSlip = NORMAL_FRICTION;
}

// Apply engine force to rear wheels only (RWD for drift)
vehicle.applyEngineForce(controls.forward ? MAX_ENGINE_FORCE : 0, 2);
vehicle.applyEngineForce(controls.forward ? MAX_ENGINE_FORCE : 0, 3);

// Steering on front wheels only
vehicle.setSteeringValue(steerAngle, 0);
vehicle.setSteeringValue(steerAngle, 1);

// Brake
const brakeForce = controls.brake ? MAX_BRAKE_FORCE : 0;
for (let i = 0; i < 4; i++) {
  vehicle.setBrake(brakeForce, i);
}
```

### Why Rear-Wheel Drive for Drift

driftking uses front-wheel drive (indices 0,1). This is **wrong** for drift feel:
- FWD drift: front wheels push, rear wheels slide — feels like understeer
- RWD drift: rear wheels push and slide — classic power slide

**Our car should be RWD** (engine force on wheels 2,3).

---

## Drift Detection Algorithm

From driftking `Game.ts`:

```typescript
// Get forward direction (where car is pointing)
const forward = new CANNON.Vec3(0, 0, 1);
chassisBody.quaternion.vmult(forward, forward);
forward.y = 0;
forward.normalize();

// Get velocity direction (where car is going)
const velocity = chassisBody.velocity.clone();
velocity.y = 0;
velocity.normalize();

// Drift angle = angle between forward and velocity
const dot = forward.dot(velocity);
const driftAngle = Math.acos(Math.max(-1, Math.min(1, dot)));

// Drift threshold: ~15 degrees (0.26 radians)
const DRIFT_THRESHOLD = 0.26;
const isDrifting = driftAngle > DRIFT_THRESHOLD && velocity.length() > 5;
```

### Drift Scoring

```typescript
if (isDrifting) {
  currentDriftScore += driftAngle * speed * deltaTime;
  driftMultiplier = Math.min(driftMultiplier + deltaTime * 2, 5);
} else if (currentDriftScore > 0) {
  // Bank the score
  totalScore += currentDriftScore * driftMultiplier;
  currentDriftScore = 0;
  driftMultiplier = 1;
}
```

---

## Skid Marks Implementation

From driftking: Canvas texture approach.

```typescript
// Create a large canvas for skid marks
const skidCanvas = document.createElement('canvas');
skidCanvas.width = 2048;
skidCanvas.height = 2048;
const skidCtx = skidCanvas.getContext('2d')!;

const skidTexture = new THREE.CanvasTexture(skidCanvas);
const skidMaterial = new THREE.MeshBasicMaterial({
  map: skidTexture,
  transparent: true,
  depthWrite: false,
  blending: THREE.MultiplyBlending,
});

const skidPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  skidMaterial
);
skidPlane.rotation.x = -Math.PI / 2;
skidPlane.position.y = 0.01; // slightly above ground
scene.add(skidPlane);

function drawSkidmark(worldX: number, worldZ: number) {
  // Convert world position to canvas UV coordinates
  const u = (worldX / 200 + 0.5) * skidCanvas.width;
  const v = (worldZ / 200 + 0.5) * skidCanvas.height;
  
  skidCtx.beginPath();
  skidCtx.arc(u, v, 3, 0, Math.PI * 2);
  skidCtx.fillStyle = 'rgba(20, 20, 20, 0.8)';
  skidCtx.fill();
  
  skidTexture.needsUpdate = true;
}
```

---

## Tire Smoke Particles

Simple particle system for drift smoke:

```typescript
// Use THREE.Points or instanced mesh for particles
// Spawn particles at rear wheel positions when drifting
// Particles rise slowly, fade out, scale up

const smokeParticles: Array<{
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}> = [];

function emitSmoke(position: THREE.Vector3) {
  smokeParticles.push({
    position: position.clone(),
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * 0.5,
      Math.random() * 1.0 + 0.5,  // rise
      (Math.random() - 0.5) * 0.5
    ),
    life: 0,
    maxLife: 1.0 + Math.random() * 0.5,
  });
}
```

---

## Physics Constants Reference

| Constant | Default | Range | Effect |
|----------|---------|-------|--------|
| `chassisMass` | 150 | 50-500 | Weight. Higher = more inertia |
| `suspensionStiffness` | 60 | 10-200 | Ride stiffness. Higher = bouncier |
| `suspensionRestLength` | 0.3 | 0.1-0.5 | Ride height |
| `dampingCompression` | 0.3 | 0.01-1.0 | Impact absorption |
| `dampingRelaxation` | 0.5 | 0.01-1.0 | Rebound speed |
| `frictionSlip` | 5.0 | 0.1-10.0 | Tire grip. Lower = more slide |
| `rollInfluence` | 0.1 | 0-1.0 | Body roll in turns |
| `maxEngineForce` | 1200 | 200-3000 | Acceleration |
| `maxBrakeForce` | 50 | 10-200 | Braking power |
| `maxSteerAngle` | 0.5 | 0.2-0.8 | Max turn angle (radians) |

---

## Speed-Dependent Steering

From Racez.io and circuit-rush — reduce steering at high speed:

```typescript
function getMaxSteering(speedKPH: number): number {
  const MIN_STEER = 0.15;
  const MAX_STEER = 0.5;
  const MAX_SPEED = 150;
  
  if (speedKPH >= MAX_SPEED) return MIN_STEER;
  const t = speedKPH / MAX_SPEED;
  return MAX_STEER - (MAX_STEER - MIN_STEER) * t;
}
```

## Friction Circle Clamping

From circuit-rush — prevent unrealistic combined lateral + longitudinal forces:

```typescript
function clampByGrip(longitudinal: number, lateral: number, maxGrip: number) {
  const magnitude = Math.sqrt(longitudinal * longitudinal + lateral * lateral);
  if (magnitude > maxGrip) {
    const scale = maxGrip / magnitude;
    return { longitudinal: longitudinal * scale, lateral: lateral * scale };
  }
  return { longitudinal, lateral };
}
```

## Sources

- `driftking/game/Game.ts` — Drift detection, frictionSlip, skid marks
- `driftking/game/Sound.ts` — Audio patterns
- `circuit-rush/src/components/vehicle/index.tsx` — Grip model, RPM sim
- `circuit-rush/src/lib/vehicle/calc.ts` — Steering, transmission
- `web-racing/frontend/src/modules/car.js` — Ammo.js vehicle (translate to cannon-es)
- `web-racing/frontend/src/modules/track.js` — Triangle mesh collision
