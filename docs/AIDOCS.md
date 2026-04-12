# 🏎️ Racing Game — AI Documentation

> **Master reference document.** Everything an AI (or human) needs to understand this project.

---

## Project Overview

- **What:** Browser-based multiplayer arcade racing game
- **Target:** 1-week game jam
- **Goal:** Deployed, playable in browser at racez.io level
- **Players:** 2-4 players (P2P multiplayer)

### Final Goal

- Multiplayer (2-4 players) arcade racing
- Drift mechanics with scoring
- Multiple tracks (Kenney tile system + procedural generation)
- Clean UI with lobby, HUD, leaderboard

---

## Tech Stack & WHY

### Rendering: Three.js (NOT R3F, NOT Babylon.js, NOT Godot)

**WHY Three.js:**
- Every real browser racing game uses Three.js (Racez.io, driftking, circuit-rush)
- ~100k GitHub stars vs Babylon's ~23k — way more examples and answers
- cannon-es RaycastVehicle is THE standard for browser car physics, works natively with Three.js
- GLTFLoader is battle-tested — every free car model loads directly

**WHY NOT R3F:**
- Adds React complexity for no benefit in game loops
- circuit-rush's 200-line vehicle component fights `useState` for real-time state
- Can't test game logic independently of React

**WHY NOT Babylon.js:**
- 5 racing repos on GitHub, max 3 stars. Zero deployed multiplayer games.
- Havok physics exists but zero racing game examples use it

**WHY NOT Godot:**
- 0 web racing results on GitHub
- Heavy export (~5-10MB minimum), slow to load
- Debugging through browser console is a nightmare

### Physics: cannon-es (RaycastVehicle)

**WHY:** Both driftking and circuit-rush use it. Proven vehicle physics in browser.
**Key trick:** `frictionSlip` manipulation for drift — drop rear wheel friction from 5.0 (normal) → 0.5 (handbrake)
**Sources:** `driftking/game/Game.ts`, `circuit-rush/src/components/vehicle/`

### Networking: PeerJS (WebRTC P2P)

**WHY:** Racez.io uses it successfully. Zero server deployment for game state.
**HOW:** Host-client relay pattern. Express only for lobby codes (create/join/lobby state).
**WHY NOT WebSocket/Colyseus:** More infrastructure, overkill for 2-4 players
**Sources:** `web-racing/frontend/src/modules/multiplayer.js`

### Build: Vite + TypeScript (strict) + Biome

**WHY:** Modern, fast, type-safe. Biome over ESLint: faster, all-in-one (lint + format).

### Server: Express (minimal)

**WHY:** Only needs party code management (create/join/lobby state). NOT for game state — that's P2P.

---

## Reference Projects

### 1. Racez.io (MankyDanky/web-racing) — THE multiplayer reference
- **URL:** https://github.com/MankyDanky/web-racing
- **Live:** https://racez.io
- **Tech:** Three.js + ammo.js + PeerJS + Django
- **Key files:**
  - `frontend/src/main.js` — Game loop, scene setup (~1632 lines)
  - `frontend/src/modules/multiplayer.js` — PeerJS P2P networking
  - `frontend/src/modules/track.js` — GLB track loading + physics collider generation
  - `frontend/src/modules/gates.js` — Checkpoint system
  - `frontend/src/modules/minimap.js` — Canvas minimap
- **Copy:** PeerJS host-relay pattern, track GLB loading, gate checkpoint system
- **Avoid:** 1600-line main.js with window globals, ammo.js (use cannon-es instead)

### 2. driftking (harked/driftking) — THE drift mechanics reference
- **URL:** https://github.com/harked/driftking
- **Tech:** Three.js + cannon-es + Vite + TypeScript + Tone.js
- **Key files:**
  - `game/Game.ts` — Drift detection, frictionSlip manipulation, skid marks, particles (~350 lines)
  - `game/Sound.ts` — Engine sound via Tone.js (~80 lines)
- **Copy:** Drift detection (`Math.acos(forward.dot(velocity.unit()))`), frictionSlip trick, canvas skid marks
- **Fix:** Front-wheel drive (should be rear-wheel for drift)

### 3. circuit-rush (iaruso/circuit-rush) — THE vehicle physics reference
- **URL:** https://github.com/iaruso/circuit-rush
- **Tech:** Next.js + R3F + @react-three/cannon + GSAP
- **Key files:**
  - `src/components/vehicle/index.tsx` — Grip model, DRS, RPM simulation
  - `src/components/vehicle/camera.tsx` — Chase camera with lateral slide
  - `src/lib/vehicle/calc.ts` — `clampByGrip`, speed-dependent steering
- **Copy:** Friction circle clamping, speed-dependent force curve, camera system
- **Avoid:** R3F for game logic, Leva for production

### 4. Opace 3D-Racing (Babylon.js comparison)
- **URL:** https://github.com/OpaceDigitalAgency/3D-Racing
- **Tech:** Babylon.js + React
- **Interesting:** Custom bicycle model (no physics engine), built-in post-processing (SSAO, SSR, TAA)
- **Why NOT using:** See engine comparison above

---

## Source Code Index

Full index of all reference files: [`../SOURCES.md`](../../SOURCES.md)

---

## Asset Index

Full inventory: [`docs/assets/INDEX.md`](assets/INDEX.md)

---

## Physics Constants

From `src/shared/constants.ts` and reference projects:

| Constant | Value | What It Controls |
|----------|-------|------------------|
| `GRAVITY` | -20 | Downward force. -20 for arcade feel (driftking uses this). |
| `CHASSIS_MASS` | 150 | Vehicle weight. Heavier = more inertia, harder to drift. Racez.io uses 200. |
| `CHASSIS_HALF_EXTENTS` | {x:0.9, y:0.3, z:2.0} | Chassis collision box size |
| `WHEEL_RADIUS` | 0.35 | Wheel collision radius |
| `WHEEL_WIDTH` | 0.3 | Wheel collision width |
| `SUSPENSION_REST_LENGTH` | 0.3 | Default suspension length |
| `SUSPENSION_STIFFNESS` | 30 | Spring stiffness. Higher = stiffer ride. |
| `DAMPING_COMPRESSION` | 4.4 | Compression damping (from driftking) |
| `DAMPING_RELAXATION` | 2.3 | Relaxation damping (from driftking) |
| `FRICTION_SLIP_NORMAL` | 5.0 | Normal tire grip. Drop to 0.5 on handbrake for drift. |
| `FRICTION_SLIP_DRIFT` | 0.5 | Drift tire grip (handbrake) |
| `ROLL_INFLUENCE` | 0.01 | Body roll amount. 0 = no roll, 1 = full. |
| `MAX_ENGINE_FORCE` | 1200 | Forward acceleration force on drive wheels |
| `MAX_BRAKE_FORCE` | 100 | Braking force on all wheels |
| `MAX_STEER` | 0.5 | Max steering in radians (~29°). Speed-dependent in practice. |
| `PHYSICS_STEP` | 1/60 | Fixed physics timestep |
| `PHYSICS_SUBSTEPS` | 3 | Substeps per physics step for stability |

### Key Physics Patterns

**Drift trigger:** Set rear wheel `frictionSlip` from 5.0 → 0.5 when handbrake held.
**Drift detection:** `Math.acos(forward.dot(velocity.normalize())) > threshold` (angle between heading and velocity direction).
**Speed-dependent steering:** Max steer angle decreases linearly from 0.5 rad at 0 km/h to 0.15 at 150+ km/h.

See [`docs/research/PHYSICS_RESEARCH.md`](research/PHYSICS_RESEARCH.md) for full details.

---

## Procedural Track Generation

### Debug Page
- **URL:** `http://localhost:3000/debug-track/` (when `bun run dev` is running)
- **Built source:** `debug-track.html` at repo root (Vite entry point)
- **Build config:** `vite-debug.config.js`
- **Built output:** `public/debug-track/` (pre-built, served as static)
- **URL params:** `?seed=42&points=14&width=12&elev=40&tight=5&downhill=60`
- **Features:** OrbitControls, seed slider, random seed button, track stats overlay

### Architecture

```
SEED → mulberry32 PRNG → control points on deformed circle →
CatmullRomCurve3 (closed) → dense sampling → road mesh + scenery
```

**Key design decisions:**
- **Deformed circle** (not random walk) for guaranteed loop closure
- **Base radius:** 350-850m depending on tightness → 3.5-3.7km track length
- **Seeded PRNG:** `mulberry32` — same seed = identical track across all clients
- **1D value noise** for elevation profile (seeded permutation table)
- **Kenney-style colors:** road `#444`, kerbs `#cc3333`, grass `#4d8f6e`
- **Scenery:** barriers on curves (curvature > 0.15), fences on straights, pylons on gentle turns
- **Trees:** 80-140 procedurally scattered, two sizes
- **Light posts:** every 50m, alternating sides

### Track Generation Pipeline (for game integration)

1. Server generates seed + parameters (~50 bytes)
2. All clients receive seed, run identical `TrackGen.generate()`
3. Output: road mesh (BufferGeometry), scenery positions, spline curve
4. Road mesh → cannon-es trimesh collider
5. Barriers → cannon-es box colliders
6. Spline curve → checkpoint/lap validation

### Realistic Track Values

| Parameter | Target | Notes |
|-----------|--------|-------|
| Track width | 12m | 3 lanes, room to pass |
| Lap length | 3-5km | ~3min at 80km/h avg |
| Min turn radius | ~50m | From CatmullRom smoothing |
| Elevation range | 30-60m | Noise + downhill bias |
| Grade | 3-6% | Noticeable but not brutal |
| Surface | Dark grey (#444) | Kenney style, vertex-colored |

---

## Networking Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Express Server                    │
│  POST /api/party/create → { code, peerId }          │
│  POST /api/party/join    → { code, peerId, players } │
│  GET  /api/party/:code   → { players, hostPeerId }  │
└──────────┬──────────────────────────┬───────────────┘
           │  (only lobby/signaling)  │
           ▼                          ▼
┌──────────────────┐    WebRTC     ┌──────────────┐
│   HOST PEER      │◄────────────►│ CLIENT PEER  │
│                  │               │              │
│  - Runs physics  │               │  - Receives  │
│  - Relays state  │──────────────►│    all state │
│  - 20Hz broadcast│               │  - Sends own │
│                  │◄──────────────│    position  │
└──────────────────┘               └──────────────┘
```

**Data per tick (~33ms at 30Hz):**
```typescript
// NetworkMessage type "state" — sent by each client to host
type CarState = {
  position: { x: number, y: number, z: number },
  quaternion: { x: number, y: number, z: number, w: number },
  velocity: { x: number, y: number, z: number },
  speed: number,         // km/h
  steerAngle: number,
  raceProgress: { gateIndex: number, distanceToNextGate: number, lap: number },
};
```

See [`docs/research/NETWORKING_RESEARCH.md`](research/NETWORKING_RESEARCH.md) for full details.

---

## Development Roadmap

### Phase 1: Core Single Player (Days 1-2)
- [ ] Three.js scene with lighting and ground plane
- [ ] cannon-es physics world with RaycastVehicle
- [ ] Basic car with steering, acceleration, braking
- [ ] Third-person chase camera
- [ ] Load first track (GLB from Kenney pieces)

### Phase 2: Drift Mechanics (Day 3)
- [ ] frictionSlip manipulation for handbrake drift
- [ ] Drift angle detection and scoring
- [ ] Canvas-based skid marks
- [ ] Tire smoke particles
- [ ] Engine sound (Web Audio API — see docs/AUDIO_TODO.md)

### Phase 3: Track & Race (Days 3-4)
- [ ] Procedural track generation (seed-based deterministic, CatmullRom spline)
- [ ] Track visualizer/debug page (public/debug-track/)
- [ ] Road mesh from spline with Kenney-style materials
- [ ] Scenery placement (barriers, fences, trees, lights, pylons)
- [ ] Checkpoint/gate system for lap counting
- [ ] Lap timer and best lap tracking
- [ ] Multiple track layouts (via seed)
- [ ] Minimap (canvas overlay)
- [ ] Start/finish detection

### Phase 4: Multiplayer (Days 5-6)
- [ ] Express server with party code system
- [ ] PeerJS P2P connections
- [ ] Host-relay state broadcast
- [ ] Lobby UI (create/join game)
- [ ] Player name and car color selection
- [ ] Countdown synchronization
- [ ] Race results / leaderboard

### Phase 5: Polish & Deploy (Day 7)
- [ ] HUD with speedometer, position, lap counter
- [ ] Post-processing (bloom, SSAO)
- [ ] Mobile touch controls
- [ ] Responsive layout
- [ ] Deploy to Vercel/Netlify

---

## File Structure

```
game/
├── docs/
│   ├── AIDOCS.md                    ← THIS FILE — master reference
│   ├── architecture.md              ← System architecture, data flow
│   ├── research/
│   │   ├── PHYSICS_RESEARCH.md      ← Car physics, drift, cannon-es
│   │   ├── NETWORKING_RESEARCH.md   ← PeerJS, WebRTC, multiplayer
│   │   ├── ENGINE_COMPARISON.md     ← Three.js vs Babylon.js vs Godot
│   │   └── AUDIO_RESEARCH.md        ← Engine sound, SFX, Tone.js
│   └── assets/
│       └── INDEX.md                 ← Asset inventory
├── src/
│   ├── client/
│   │   ├── main.ts                  ← Entry point, game bootstrap
│   │   ├── game/
│   │   │   ├── Game.ts              ← Main game loop, orchestrator
│   │   │   ├── InputManager.ts      ← Keyboard/gamepad input
│   │   │   ├── PhysicsWorld.ts      ← cannon-es world setup
│   │   │   └── SceneManager.ts      ← Three.js scene, renderer
│   │   ├── vehicle/
│   │   │   ├── Vehicle.ts           ← RaycastVehicle wrapper
│   │   │   ├── VehicleControls.ts   ← Input → vehicle forces
│   │   │   └── VehicleCamera.ts     ← Chase camera system
│   │   ├── track/
│   │   │   ├── TrackLoader.ts       ← GLB track loading
│   │   │   └── TrackGenerator.ts    ← Procedural track from spline
│   │   ├── multiplayer/
│   │   │   ├── NetworkManager.ts    ← PeerJS connection management
│   │   │   ├── HostRelay.ts         ← Host relay logic
│   │   │   └── ClientSync.ts        ← Client state interpolation
│   │   ├── audio/
│   │   │   └── AudioManager.ts      ← Web Audio API (postponed)
│   │   ├── effects/
│   │   │   ├── SkidMarks.ts         ← Canvas skid marks
│   │   │   ├── ParticleSystem.ts    ← Tire smoke particles
│   │   │   └── PostProcessing.ts    ← Bloom, SSAO, etc.
│   │   ├── ui/
│   │   │   ├── HUD.ts               ← Speed, position, lap display
│   │   │   ├── Lobby.ts             ← Create/join game UI
│   │   │   └── Leaderboard.ts       ← Race results
│   │   ├── utils/
│   │   │   └── math.ts              ← Vector math helpers
│   │   └── types/
│   │       └── index.ts             ← Client-side type definitions
│   ├── server/
│   │   └── index.ts                 ← Express server (party codes only)
│   └── shared/
│       ├── constants.ts             ← Physics constants, tuning params
│       └── types.ts                 ← Shared type definitions
├── public/
│   ├── debug-track/                ← Procedural track visualizer (pre-built)
│   │   ├── index.html
│   │   └── assets/
│   ├── models/cars/                ← Car GLBs (Kenney karts + circuit-rush)
│   └── assets/
│       ├── kenney-car-kit/          ← Full Kenney vehicle pack (GLB)
│       └── kenney-racing-kit/       ← Full Kenney racing pack (GLB)
├── .github/workflows/ci.yml        ← GitHub Actions (typecheck + biome + build)
├── .husky/pre-commit               ← Pre-commit hook (biome + tsc)
├── Dockerfile                      ← Multi-stage Bun → nginx
├── compose.yaml                    ← Docker Compose (production + dev)
├── nginx.conf                      ← SPA routing for production
├── .nvmrc                          ← Node 22
├── CONTRIBUTING.md                 ← Dev workflow guide
├── index.html
├── package.json
├── biome.json
├── tsconfig.json
└── vite.config.ts
```

---

## Related Documents

- **Audio TODO:** [`docs/AUDIO_TODO.md`](AUDIO_TODO.md) — What's missing, where to get it
- **Architecture:** [`docs/architecture.md`](architecture.md) — System architecture details
- **Physics:** [`docs/research/PHYSICS_RESEARCH.md`](research/PHYSICS_RESEARCH.md) — Physics deep dive
- **Networking:** [`docs/research/NETWORKING_RESEARCH.md`](research/NETWORKING_RESEARCH.md) — Networking deep dive
- **Audio research:** [`docs/research/AUDIO_RESEARCH.md`](research/AUDIO_RESEARCH.md) — Engine sound synthesis
- **Engine comparison:** [`docs/research/ENGINE_COMPARISON.md`](research/ENGINE_COMPARISON.md) — Why Three.js
- **Asset index:** [`docs/assets/INDEX.md`](assets/INDEX.md) — Complete asset inventory
- **Contributing:** [`CONTRIBUTING.md`](../CONTRIBUTING.md) — How to work on this project
