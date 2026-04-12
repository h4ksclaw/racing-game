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
| `CHASSIS_MASS` | 150 | Vehicle weight. Heavier = more inertia, harder to drift. Racez.io uses 200. |
| `VEHICLE_WIDTH` | 1.8 | Chassis box half-extent X |
| `VEHICLE_HEIGHT` | 0.6 | Chassis box half-extent Y |
| `VEHICLE_LENGTH` | 4.0 | Chassis box half-extent Z |
| `WHEEL_RADIUS` | 0.35 | Wheel collision radius |
| `WHEEL_WIDTH` | 0.3 | Wheel collision width |
| `SUSPENSION_REST_LENGTH` | 0.3 | Default suspension length |
| `SUSPENSION_STIFFNESS` | 60 | Spring stiffness. Higher = stiffer ride. Racez.io: 50. |
| `DAMPING_COMPRESSION` | 0.3 | Compression damping |
| `DAMPING_RELAXATION` | 0.5 | Relaxation damping |
| `FRICTION_SLIP` | 5.0 | Normal tire grip. Drop to 0.5 on handbrake for drift. |
| `ROLL_INFLUENCE` | 0.1 | Body roll amount. 0 = no roll, 1 = full. |
| `MAX_ENGINE_FORCE` | 1200 | Forward acceleration force on drive wheels |
| `MAX_BRAKE_FORCE` | 50 | Braking force on all wheels |
| `MAX_STEER_ANGLE` | 0.5 | Max steering in radians (~29°). Speed-dependent in practice. |
| `PHYSICS_STEP` | 1/60 | Fixed physics timestep |
| `PHYSICS_SUBSTEPS` | 3 | Substeps per physics step for stability |

### Key Physics Patterns

**Drift trigger:** Set rear wheel `frictionSlip` from 5.0 → 0.5 when handbrake held.
**Drift detection:** `Math.acos(forward.dot(velocity.normalize())) > threshold` (angle between heading and velocity direction).
**Speed-dependent steering:** Max steer angle decreases linearly from 0.5 rad at 0 km/h to 0.15 at 150+ km/h.

See [`docs/research/PHYSICS_RESEARCH.md`](research/PHYSICS_RESEARCH.md) for full details.

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

**Data per tick (~50ms):**
```typescript
{
  position: { x, y, z },        // toFixed(2)
  quaternion: { x, y, z, w },  // toFixed(4)
  raceProgress: { gateIndex, distanceToNextGate },
  playerColor: string,
  playerName: string,
  speed: number
}
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
- [ ] Engine sound (Tone.js)

### Phase 3: Track & Race (Days 3-4)
- [ ] Checkpoint/gate system for lap counting
- [ ] Lap timer and best lap tracking
- [ ] Multiple track layouts
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
│   │   │   └── AudioManager.ts      ← Tone.js audio
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
│   └── assets/
│       ├── kenney-car-kit/          ← Kenney vehicle models (GLB)
│       └── kenney-racing-kit/       ← Kenney racing track pieces (GLB)
├── index.html
├── package.json
├── biome.json
├── tsconfig.json
└── vite.config.ts
```

---

## Related Documents

- **Parent research:** [`../../RESEARCH.md`](../../RESEARCH.md) — Original deep research
- **Repo analysis:** [`../../ANALYSIS.md`](../../ANALYSIS.md) — Full repo-by-repo analysis
- **Source index:** [`../../SOURCES.md`](../../SOURCES.md) — All reference file locations
- **Architecture:** [`docs/architecture.md`](architecture.md) — System architecture details
- **Physics:** [`docs/research/PHYSICS_RESEARCH.md`](research/PHYSICS_RESEARCH.md) — Physics deep dive
- **Networking:** [`docs/research/NETWORKING_RESEARCH.md`](research/NETWORKING_RESEARCH.md) — Networking deep dive
- **Engine comparison:** [`docs/research/ENGINE_COMPARISON.md`](research/ENGINE_COMPARISON.md) — Why Three.js
