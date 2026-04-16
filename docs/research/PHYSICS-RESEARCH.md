# Car Physics & Engine Sound Research

> Research compiled 2026-04-16 for racing game physics engine improvements.

---

## Part A: Tire Physics (CRITICAL)

### 1. Pacejka Tire Model (Magic Formula)

The Pacejka "Magic Formula" is the industry-standard empirical tire model. It maps slip to force using a characteristic S-shaped curve that rises linearly, peaks, then falls off — matching real tire behavior.

#### Full Pacejka '94 Formula

```
F = D * sin(C * arctan(B*x - E * (B*x - arctan(B*x)))) + V
```

Where `x` is either slip angle (degrees) for lateral force or slip ratio (%) for longitudinal force.

**Coefficients:**
| Coefficient | Name | Description |
|-------------|------|-------------|
| B | Stiffness factor | How quickly force builds with slip |
| C | Shape factor | 1.3 (lateral), 1.65 (longitudinal) |
| D | Peak factor | Maximum force = Fz * D (friction coefficient) |
| E | Curvature factor | Shape near peak; negative = sharper peak |
| H | Horizontal shift | Small offset (often 0) |
| V | Vertical shift | Small offset (often 0) |

#### Simplified Version for Games (RECOMMENDED)

Use constant B, C, D, E coefficients — no load dependency. This reduces 13+ parameters to just 4 per force direction.

```
F = Fz * D * sin(C * arctan(B * slip - E * (B * slip - arctan(B * slip))))
```

**Typical values:**

| Surface | B | C | D | E |
|---------|---|---|---|---|
| Dry tarmac | 10 | 1.9 | 1.0 | 0.97 |
| Wet tarmac | 12 | 2.3 | 0.82 | 1.0 |
| Snow | 5 | 2.0 | 0.3 | 1.0 |
| Ice | 4 | 2.0 | 0.1 | 1.0 |

**Cost:** ~50ns per tire (one sin, one arctan, a few multiplies). Negligible at 60fps.

#### Implementation (TypeScript)

```typescript
function pacejka(slip: number, Fz: number, B: number, C: number, D: number, E: number): number {
  const x = B * slip;
  return Fz * D * Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}

// Per wheel per frame:
const Fx = pacejka(longitudinalSlip, Fz, 10, 1.65, 1.0, 0.97);
const Fy = pacejka(slipAngle, Fz, 10, 1.3, 1.0, -0.5);
```

---

### 2. Tire Slip Mechanics

#### Slip Angle (Lateral)

The angle between where the tire is pointing vs where it's actually going:

```
slipAngle = atan2(lateralVelocity, |longitudinalVelocity|)
```

In practice, for each wheel:
1. Compute wheel velocity in wheel-local coords (transform car velocity to wheel frame)
2. `vx_local` = component along wheel heading
3. `vy_local` = component perpendicular to wheel heading
4. `slipAngle = atan2(vy_local, |vx_local|)` (in radians, convert to degrees for Pacejka)

#### Slip Ratio (Longitudinal)

```
slipRatio = (wheelSpeed - vehicleSpeed) / max(|wheelSpeed|, |vehicleSpeed|, 0.5)
```

- Positive = wheel spinning faster than ground (acceleration/wheelspin)
- Negative = wheel slower than ground (braking/locked)
- The `0.5` epsilon prevents division by zero at standstill

Multiply by 100 for Pacejka percentage input.

#### Friction Circle (Combined Slip)

A tire can't produce maximum lateral AND longitudinal force simultaneously. The combined force is bounded:

```
F_total = sqrt(Fx^2 + Fy^2) <= mu * Fz
```

**Simple implementation:** Compute Fx and Fy independently via Pacejka, then if combined exceeds the limit, scale both down proportionally:

```typescript
const maxForce = mu * Fz;
const totalForce = Math.sqrt(Fx * Fx + Fy * Fy);
if (totalForce > maxForce) {
  const scale = maxForce / totalForce;
  Fx *= scale;
  Fy *= scale;
}
```

**Better implementation:** Use a combined slip weighting. Reduce available grip in one direction based on usage in the other:

```typescript
const slipWeight = Math.sqrt(longSlip^2 + latSlip^2) / maxSlip;
const gripFactor = 1.0 / (1.0 + slipWeight);
// Apply gripFactor to both forces
```

#### Understeer vs Oversteer

- **Understeer:** Front tires are saturated (high slip angle, past peak). Car turns less than steering input requests. Feels "pushy."
- **Oversteer/Drift:** Rear tires are saturated. Rear slides outward. Car rotates more than intended.
- **Neutral:** All tires at similar slip percentages. Balanced cornering.

This emerges naturally from Pacejka — no special cases needed.

---

### 3. Drift Physics

#### What Makes a Car Drift

A drift occurs when rear tire lateral force exceeds available grip, causing the rear to slide outward. The car then travels at an angle to its heading (yaw angle > slip angle).

#### Initiating a Drift

**Handbrake method:**
1. Driver pulls handbrake → rear wheels lock (or slow dramatically)
2. Locked wheel has slip ratio ≈ -100%
3. Friction circle is consumed by longitudinal braking force
4. Available lateral grip drops dramatically
5. Centripetal force from the turn exceeds remaining lateral grip
6. Rear slides outward → drift initiated

**Weight transfer method:**
1. Brake hard → weight shifts forward (front Fz increases, rear Fz decreases)
2. Less rear Fz = less rear lateral grip (F = mu * Fz)
3. Turn in while rear is light → rear breaks loose
4. This is how real race drivers initiate drifts

**Scandinavian flick:**
1. Brief counter-steer away from corner
2. Weight transfers to outside-rear
3. Quick steer into corner → weight snaps, rear breaks loose

#### Maintaining a Drift

Once drifting, the driver must **counter-steer** (steer into the slide) to control the yaw rate. The key balance:

- More throttle → more rear wheelspin → more longitudinal slip → less lateral grip → wider angle
- Counter-steer → front tires generate lateral force to control rotation
- Modulate throttle and steering to hold desired angle

#### Physics Implementation for Drift

```typescript
// The drift emerges naturally from Pacejka + friction circle
// No special "drift mode" needed

// For each rear wheel:
const rearSlipRatio = (rearWheelSpeed - carSpeed) / max(rearWheelSpeed, carSpeed, 0.5);
const rearSlipAngle = Math.atan2(rearVy, Math.abs(rearVx)) * (180 / Math.PI);

let rearFx = pacejka(rearSlipRatio * 100, rearFz, 10, 1.65, 1.0, 0.97);
let rearFy = pacejka(rearSlipAngle, rearFz, 10, 1.3, 1.0, -0.5);

// Friction circle clamp
const maxGrip = mu * rearFz;
const total = Math.sqrt(rearFx * rearFx + rearFy * rearFy);
if (total > maxGrip) {
  const s = maxGrip / total;
  rearFx *= s;
  rearFy *= s;
}

// When handbrake: force slip ratio to -100 (locked wheel)
if (handbrake) {
  rearFx = pacejka(-100, rearFz, 10, 1.65, 1.0, 0.97);
  // This consumes most of the friction circle
  // Lateral grip is now very limited → rear slides
}
```

**Key tuning parameter:** The `D` (peak) coefficient. Higher D = more grip = harder to drift. Lower D = easier to break loose. For a drift-friendly game, use D ≈ 0.8-0.9 instead of 1.0.

---

### 4. Speed-Dependent Turning

With proper slip angle physics, speed-dependent turning is **automatic**:

1. At low speed, tire velocity is low, so small steering angle produces appropriate slip angle
2. At high speed, the same steering angle doesn't change the velocity direction much (high inertia)
3. Higher lateral velocity component → higher slip angle → tire may be past peak → less lateral force → wider turn

**No special coding needed** — it's a natural consequence of the slip angle model. This is one of the biggest advantages of Pacejka over simple `turnRate = speed * steerAngle` models.

---

### 5. Weight Transfer

Weight transfer is critical for realistic feel and directly affects grip distribution:

```
// Static weight distribution
Wf_static = (c / L) * totalWeight    // front
Wr_static = (b / L) * totalWeight    // rear

// Dynamic (longitudinal acceleration 'a' in m/s²)
Wf = Wf_static - (h / L) * mass * a   // braking: a < 0 → Wf increases
Wr = Wr_static + (h / L) * mass * a   // braking: a < 0 → Wr decreases

// Lateral weight transfer (lateral acceleration 'ay')
Wleft  = W_static_left - (h / trackWidth) * mass * ay
Wright = W_static_right + (h / trackWidth) * mass * ay
```

Where:
- `b` = CG to front axle distance
- `c` = CG to rear axle distance  
- `L` = wheelbase (b + c)
- `h` = CG height
- `trackWidth` = distance between left/right wheels

**Critical:** Weight transfer affects Fz per wheel, which directly affects Pacejka output. This creates realistic dynamics like:
- Trail braking (braking into corner) shifts weight forward → more front grip → sharper turn-in
- Throttle on exit shifts weight back → more rear grip → better traction
- Hard braking while turning → outside-front gets overloaded → understeer

---

## Part B: Collision Response with Rotation

### 1. Angular Momentum from Collisions

When a car hits something, the impulse is applied at the contact point, not the center of gravity. This creates torque:

```
torque = r × F   (2D cross product)
torque = rx * Fy - ry * Fx

angularImpulse = torque * dt
angularVelocity += angularImpulse / momentOfInertia
```

Where `r` is the vector from CG to the contact point.

#### Moment of Inertia

For a rectangular car body:
```
I = mass * (width² + length²) / 12
```

Typical car: mass=1500kg, length=4.5m, width=1.8m → I ≈ 1500 * (20.25 + 3.24) / 12 ≈ 2930 kg·m²

#### Impulse-Based Collision Response

```typescript
function resolveCollision(car, contactPoint, normal, penetration) {
  // r = vector from CG to contact point
  const rx = contactPoint.x - car.cg.x;
  const ry = contactPoint.y - car.cg.y;
  
  // Velocity at contact point (includes rotation)
  const vContactX = car.vx - car.angularVel * ry;
  const vContactY = car.vy + car.angularVel * rx;
  
  // Relative velocity along normal
  const relVelNormal = vContactX * normal.x + vContactY * normal.y;
  
  if (relVelNormal > 0) return; // Separating, no collision
  
  // Effective mass at contact point (accounts for rotation)
  const rCrossN = rx * normal.y - ry * normal.x;
  const effectiveMassInv = 1/car.mass + rCrossN * rCrossN / car.momentOfInertia;
  
  // Impulse magnitude
  const restitution = 0.3; // Bounciness (0 = perfectly inelastic)
  const j = -(1 + restitution) * relVelNormal / effectiveMassInv;
  
  // Apply impulse
  const impulseX = j * normal.x;
  const impulseY = j * normal.y;
  
  car.vx += impulseX / car.mass;
  car.vy += impulseY / car.mass;
  car.angularVel += (rx * impulseY - ry * impulseX) / car.momentOfInertia;
  
  // Position correction (prevent sinking)
  car.x += normal.x * penetration * 0.8;
  car.y += normal.y * penetration * 0.8;
}
```

### 2. Wall/Guardrail Collisions

For wall collisions, add **friction at the contact point** to create tangential force:

```typescript
// After computing normal impulse j:
const tangentX = -normal.y;
const tangentY = normal.x;

// Tangential relative velocity
const relVelTangent = vContactX * tangentX + vContactY * tangentY;

// Friction impulse (Coulomb model)
const frictionCoeff = 0.4; // Wall friction
const jt = -relVelTangent / effectiveMassInv;
const maxFriction = frictionCoeff * Math.abs(j);

const frictionImpulse = Math.abs(jt) > maxFriction 
  ? maxFriction * Math.sign(jt) 
  : jt;

// Apply friction impulse
car.vx += frictionImpulse * tangentX / car.mass;
car.vy += frictionImpulse * tangentY / car.mass;
car.angularVel += (rx * (frictionImpulse * tangentY) - ry * (frictionImpulse * tangentX)) / car.momentOfInertia;
```

**What this produces:**
- Hitting a wall head-on → car bounces back (normal impulse only)
- Hitting a wall at an angle → car spins (torque from off-center impact)
- Grazing a wall → friction slows the car and induces spin (realistic scraping behavior)
- This is the missing piece that makes collisions feel satisfying instead of just bouncing

### 3. Car-to-Car Collisions

Same principle, but both cars receive impulses:

```typescript
function carToCarCollision(car1, car2, contactPoint, normal) {
  const r1x = contactPoint.x - car1.cg.x;
  const r1y = contactPoint.y - car1.cg.y;
  const r2x = contactPoint.x - car2.cg.x;
  const r2y = contactPoint.y - car2.cg.y;
  
  // Velocity at contact for each car
  const v1x = car1.vx - car1.angularVel * r1y;
  const v1y = car1.vy + car1.angularVel * r1x;
  const v2x = car2.vx - car2.angularVel * r2y;
  const v2y = car2.vy + car2.angularVel * r2x;
  
  // Relative velocity
  const relVelX = v1x - v2x;
  const relVelY = v1y - v2y;
  const relVelN = relVelX * normal.x + relVelY * normal.y;
  
  if (relVelN > 0) return;
  
  const r1CrossN = r1x * normal.y - r1y * normal.x;
  const r2CrossN = r2x * normal.y - r2y * normal.x;
  const effMassInv = 1/car1.mass + 1/car2.mass 
    + r1CrossN*r1CrossN/car1.momentOfInertia 
    + r2CrossN*r2CrossN/car2.momentOfInertia;
  
  const j = -(1 + 0.3) * relVelN / effMassInv;
  
  // Apply to both cars (opposite directions)
  car1.vx += j * normal.x / car1.mass;
  car1.vy += j * normal.y / car1.mass;
  car1.angularVel += (r1x * j * normal.y - r1y * j * normal.x) / car1.momentOfInertia;
  
  car2.vx -= j * normal.x / car2.mass;
  car2.vy -= j * normal.y / car2.mass;
  car2.angularVel -= (r2x * j * normal.y - r2y * j * normal.x) / car2.momentOfInertia;
}
```

---

## Part C: Engine Sound Synthesis

### 1. Procedural Engine Sound Approach

Real engine sounds are **not** pre-recorded loops. AAA games synthesize them in real-time because RPM varies continuously and pre-recorded samples can't cover every state.

#### Engine Sound Components

An engine sound has these layers:
1. **Engine order noise** — The fundamental combustion frequency and harmonics (order-based)
2. **Intake/exhaust resonance** — Resonant frequencies from air pathways
3. **Mechanical noise** — Valve train, gears, bearings (broadband)
4. **Turbo/supercharger** — Whine proportional to boost pressure
5. **Tire noise** — Broadband, speed-dependent, surface-dependent
6. **Wind noise** — Broadband, speed-dependent

#### Order-Based Synthesis (Core Technique)

Engine sounds are organized in "orders" — harmonics of the engine's firing frequency:

```
firingFreq = (rpm / 60) * (cylinders / 2)  // for 4-stroke
// e.g., 6000 RPM, 4 cyl → 200 Hz fundamental

halfOrder = firingFreq / 2           // 100 Hz (for even-fire engines)
firstOrder = firingFreq               // 200 Hz
secondOrder = firingFreq * 2          // 400 Hz
thirdOrder = firingFreq * 3           // 600 Hz
// etc.
```

Each order has:
- An amplitude that varies with RPM (lookup table per vehicle)
- A slight frequency wobble (jitter) for realism
- Phase tracking to avoid clicks when frequency changes

#### Web Audio API Implementation

```typescript
class EngineSynth {
  private ctx: AudioContext;
  private oscillators: OscillatorNode[] = [];
  private gains: GainNode[] = [];
  private rpm: number = 800;
  
  constructor(ctx: AudioContext, cylinders: number = 4) {
    this.ctx = ctx;
    const numOrders = 8;
    
    for (let i = 0; i < numOrders; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sawtooth'; // Rich harmonics, good base
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.value = 0;
      
      osc.start();
      this.oscillators.push(osc);
      this.gains.push(gain);
    }
  }
  
  update(rpm: number, throttle: number, dt: number) {
    this.rpm = rpm;
    const firingFreq = (rpm / 60) * (4 / 2); // 4-cyl 4-stroke
    
    // Amplitude curve per order (tuned per vehicle)
    const orderAmps = [
      0.0,  // 0.5 order (sub-harmonic, subtle)
      1.0,  // 1st order (fundamental)
      0.8,  // 2nd order
      0.6,  // 3rd order
      0.4,  // 4th order
      0.2,  // 5th order
      0.1,  // 6th order
      0.05, // 7th order
    ];
    
    for (let i = 0; i < this.oscillators.length; i++) {
      const order = (i + 1) * 0.5; // 0.5, 1.0, 1.5, 2.0...
      const freq = firingFreq * order;
      
      // Smooth frequency transition (avoid clicks)
      this.oscillators[i].frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.02);
      
      // Amplitude varies with RPM (peak around powerband)
      const rpmFactor = this.getRpmAmplitudeCurve(rpm, i);
      const targetAmp = orderAmps[i] * rpmFactor * throttle * 0.15;
      this.gains[i].gain.setTargetAtTime(targetAmp, this.ctx.currentTime, 0.05);
    }
  }
  
  getRpmAmplitudeCurve(rpm: number, orderIndex: number): number {
    // Each order peaks at different RPM ranges
    // Lower orders peak at low RPM, higher orders at high RPM
    const peakRpm = 2000 + orderIndex * 600;
    const width = 1500 + orderIndex * 200;
    return Math.exp(-((rpm - peakRpm) ** 2) / (2 * width * width));
  }
}
```

#### Better: Wavetable + Granular Approach

For more realistic sound, use short wavetable samples (one cycle of each order) and crossfade between RPM-keyed samples:

```
1. Record engine at steady RPM points (500, 1000, 1500, ..., 8000)
2. Extract one cycle at each point for each order
3. At runtime: crossfade between adjacent RPM points
4. Pitch-shift to match exact RPM
5. Layer orders with amplitude curves
```

### 2. Tire/Skid Sounds

- **Tire squeal:** High-frequency noise filtered through a bandpass, amplitude proportional to slip angle
- **Skid sound:** Lower frequency, triggered when slip exceeds grip threshold
- **Surface noise:** Speed-dependent broadband noise, filtered differently per surface type

```typescript
// Simple tire squeal using noise + bandpass
function createTireSqueal(ctx: AudioContext) {
  const bufferSize = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 3000; // Hz
  bandpass.Q.value = 5;
  
  const gain = ctx.createGain();
  gain.gain.value = 0;
  
  source.connect(bandpass);
  bandpass.connect(gain);
  gain.connect(ctx.destination);
  source.start();
  
  return { gain, bandpass }; // Modulate gain based on slip
}
```

### 3. What AAA Games Do

- **Gran Turismo:** Uses recorded samples crossfaded across RPM ranges, layered with synthesized harmonics. Each car has unique samples.
- **Forza Motorsport:** Similar hybrid approach. Known for excellent exhaust sound modeling with separate intake/exhaust layers.
- **Assetto Corsa:** Uses FMOD with multi-layered samples. Very accurate individual cylinder firing sounds.
- **Key technique:** "Cycle extraction" — record engine, detect individual firing cycles, extract them as short grains, then reassemble at any RPM.

### 4. Practical Recommendation for Our Game

**Phase 1 (Quick win):** Oscillator-based synthesis with 6-8 orders, sawtooth waves, bandpass filters. Takes ~200 lines of code. Sounds decent, fully dynamic.

**Phase 2 (Good):** Record a real engine (or find free samples), extract cycles at multiple RPMs, build a wavetable crossfading system.

**Phase 3 (AAA):** Per-cylinder granular synthesis with individual cylinder timing, intake/exhaust separation, turbo modeling.

---

## Part D: Key Resources

### 1. Marco Monster's Car Physics Tutorial
- **URL:** https://www.asawicki.info/Mirror/Car%20Physics%20for%20Games/Car%20Physics%20for%20Games.html
- **What it covers:** Straight-line physics, engine modeling, weight transfer, cornering, drifting
- **Key takeaway:** Separation of longitudinal/lateral forces; weight transfer formulas; engine torque curves
- **Quality:** Excellent starting point, though lacks Pacejka details

### 2. Edy's Vehicle Physics (Unity)
- **URL:** https://www.edy.es/dev/
- **Pacejka '94 parameter guide:** https://www.edy.es/dev/docs/pacejka-94-parameters-explained-a-comprehensive-guide/
- **Key takeaway:** The simplified Magic Formula with 4 constant coefficients is ideal for games

### 3. Open-Source Racing Games

| Game | Engine | Physics | Notes |
|------|--------|---------|-------|
| **Stunt Rally** | C++/OGRE | Custom Pacejka-based | Most complete open-source racer |
| **VDrift** | C++ | Pacejka '96 | Good tire model reference |
| **TORCS** | C++ | Custom | Old but well-documented |
| **Speed Dreams** | C++ (TORCS fork) | Custom | Active development |

**Best code reference:** Stunt Rally's tire model — look in `src/cars/cars.cpp` and related files.

### 4. Books

- **"Game Physics Engine Development" by Ian Millington** — Chapters on rigid body dynamics, impulse resolution, friction
- **"Vehicle Dynamics and Control" by Rajesh Rajamani** — Academic but thorough
- **"The Physics of Racing" by Brian Beckman** — Free online, excellent for understanding concepts

### 5. Additional Online Resources

- **Racing Game Physics by Chris Gerber (YouTube)** — Visual explanations
- **"How to Build a Car Physics Engine" series** — Various GDC talks
- **Unity WheelCollider source** — Even if not using Unity, the approach is instructive

---

## Implementation Priority

### Must Have (Biggest Impact)
1. ✅ **Pacejka simplified tire model** — Replaces linear grip with realistic slip curves
2. ✅ **Friction circle** — Combined slip limiting
3. ✅ **Weight transfer** — Dynamic Fz per wheel
4. ✅ **Collision impulse at contact point** — Spin-out on wall hits

### Should Have
5. **Proper slip angle computation** — Transform velocities to wheel-local frame
6. **Angular velocity in collision response** — Cars spin on impact
7. **Basic engine sound synthesis** — Oscillator-based, RPM-linked

### Nice to Have
8. **Combined slip weighting** (more accurate than simple clamping)
9. **Lateral weight transfer** (inside/outside wheels in turns)
10. **Per-surface tire parameters** (different Pacejka coeffs for tarmac/grass)
11. **Granular engine sound** (recorded samples crossfaded)

---

## Quick Reference: Physics Update Loop (Pseudocode)

```
function updateCar(car, input, dt):
  // 1. Engine force
  rpm = computeRPM(car, dt)
  engineTorque = torqueCurve(rpm) * input.throttle
  driveForce = engineTorque * gearRatio * diffRatio * efficiency / wheelRadius
  
  // 2. Weight transfer
  longitudinalAccel = car.acceleration  // from previous frame
  Wf = staticFrontWeight - (cgHeight / wheelbase) * car.mass * longitudinalAccel
  Wr = staticRearWeight + (cgHeight / wheelbase) * car.mass * longitudinalAccel
  
  // 3. Per-wheel forces (front left, front right, rear left, rear right)
  for each wheel:
    // 3a. Vertical force
    wheel.Fz = Wf_or_Wr / 2  // split left/right with lateral transfer
    
    // 3b. Slip computation
    wheelVelocity = carVelocity + angularVelocity × wheelOffset
    localVx = dot(wheelVelocity, wheelHeading)
    localVy = dot(wheelVelocity, wheelLateral)
    slipAngle = atan2(localVy, |localVx|) * 180/PI  // degrees
    slipRatio = (wheelAngularSpeed * wheelRadius - |localVx|) / max(...) * 100  // %
    
    // 3c. Pacejka
    wheel.Fx = pacejka(slipRatio, wheel.Fz, B_lon, C_lon, D_lon, E_lon)
    wheel.Fy = pacejka(slipAngle, wheel.Fz, B_lat, C_lat, D_lat, E_lat)
    
    // 3d. Friction circle
    clampCombinedForce(wheel)
  
  // 4. Braking
  if input.brake:
    for each wheel: wheel.Fx -= brakeForce
  
  // 5. Steering (affects front wheel heading)
  frontWheelHeading = car.heading + input.steer * maxSteerAngle
  
  // 6. Sum forces and torques
  totalFx = sum of all wheel.Fx (in car frame)
  totalFy = sum of all wheel.Fy (in car frame)
  totalTorque = sum of (wheelOffset × wheelForce) for all wheels
  
  // 7. Drag and rolling resistance
  speed = |carVelocity|
  drag = -Cdrag * speed * carVelocity
  rollingResistance = -Crr * carVelocity
  totalFx += drag.x + rollingResistance.x
  totalFy += drag.y + rollingResistance.y
  
  // 8. Integrate
  carAcceleration = (totalFx, totalFy) / car.mass  (transform to world frame)
  carVelocity += carAcceleration * dt
  car.position += carVelocity * dt
  car.angularVelocity += totalTorque / momentOfInertia * dt
  car.heading += car.angularVelocity * dt
  
  // 9. Collisions (post-integration)
  for each contact:
    resolveCollisionWithRotation(car, contact, dt)
```
