# Engine Comparison — Three.js vs Babylon.js vs Godot for Browser Racing

## GitHub Evidence

### Browser Racing Games Found

| Project | Engine | Stars | Multiplayer | Live URL |
|---------|--------|-------|-------------|----------|
| Racez.io | **Three.js** | ~50 | ✅ PeerJS | https://racez.io |
| driftking | **Three.js** | ~100 | ❌ | GitHub |
| circuit-rush | **Three.js** (R3F) | ~50 | ❌ | GitHub |
| Games-On-Web-2023 | Babylon.js | ~5 | ❌ | GitHub Pages |
| Opace 3D-Racing | Babylon.js | ~3 | ❌ | GitHub |

### Broader GitHub Search Results

- `"racing game" three.js` → **dozens** of repos, several with 50+ stars
- `"racing game" babylon.js` → **5 repos**, max 3 stars
- `"racing game" godot webgl` → **0 results**
- `"racing game" webgl` → Mix, but Three.js dominates

### Library Stars

- **Three.js:** ~100,000 stars
- **Babylon.js:** ~23,000 stars
- **Godot:** ~95,000 stars (but 0 web racing results)

---

## Why Three.js Won

### 1. cannon-es Integration

cannon-es RaycastVehicle is THE standard for browser car physics. It's used by:
- driftking (proven drift mechanics)
- circuit-rush (proven grip model)

Babylon.js has Havok physics, but there are **zero** racing game examples using Havok for vehicle physics in the browser.

### 2. Asset Compatibility

Three.js's GLTFLoader is the most battle-tested GLTF loader in the JavaScript ecosystem. Every free car model (Sketchfab, Kenney) exports as glTF/GLB and loads directly.

Babylon.js also supports GLTF, but with fewer community examples for the specific racing use case.

### 3. Community & Examples

For any racing game problem (vehicle physics, drift, skid marks, chase camera), there are Three.js examples and Stack Overflow answers. Babylon.js has far fewer racing-specific resources.

### 4. Racez.io Proves It

There is an actual deployed, working, multiplayer 3D racing game using Three.js. No Babylon.js equivalent exists.

---

## Why NOT R3F (React Three Fiber)

### The Problem

R3F wraps Three.js in React's component model. This works great for **3D websites** but fights against **game loops**.

### Evidence from circuit-rush

circuit-rush is the only R3F racing game. It shows the pain:

1. **Vehicle component (~200 lines):** Hooks, refs, and manual state syncing
2. **Physics state in React:** velocity, RPM, gear, throttle, brake — all need `useState` + subscriptions
3. **Fighting re-renders:** Real-time game state changes 60x/sec, React wants to re-render
4. **Commented-out car model:** `// @ts-expect-error` — developer couldn't get it working cleanly
5. **Leva debug controls:** Used for tuning, but not appropriate for production

### driftking is Cleaner

driftking uses vanilla Three.js with a single `Game.ts` (~400 lines):
- Physics, rendering, particles, sound — all in one class
- React only for UI overlay (score, drift display)
- Easy to reason about, easy to modify

### Verdict

**Use Three.js directly. Use React (or vanilla HTML) only for UI overlays (menus, HUD, lobby).**

---

## Why NOT Godot Web

1. **Zero web racing examples** on GitHub
2. **Heavy export:** ~5-10MB minimum for WebGL, slow to load
3. **Debugging nightmare:** Can't inspect/fix WebGL issues through browser console
4. **No web networking:** No built-in multiplayer for web export
5. **Learning curve:** For a 1-week jam, overhead of learning Godot's web export pipeline is not worth it
6. **Loss of control:** Can't easily tweak the rendering pipeline or physics for specific game feel

---

## Why NOT Babylon.js

1. **Tiny community for racing:** 5 repos, max 3 stars
2. **No deployed multiplayer racing game**
3. **Havok physics:** No vehicle physics examples in browser
4. **Smaller ecosystem:** Fewer answers, fewer examples, fewer people to learn from

---

## Final Verdict

**Three.js + cannon-es + PeerJS** — proven by Racez.io, driftking, and circuit-rush. The only stack with a deployed multiplayer browser racing game.
