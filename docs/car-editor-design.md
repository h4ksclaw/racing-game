# Car Model Editor — Design Document

**Date:** 2026-04-20
**Status:** Draft
**Scope:** Web-based GLB import, auto-scaling, semantic marker placement, and config export for the racing game.

---

## 1. Problem

Adding a new car to the game currently requires:
1. Manually editing `CarModelSchema` with hardcoded GLB node/material name strings
2. Computing `modelScale`, `halfExtents`, `wheelRadius`, `wheelBase`, `cgHeight` by hand
3. Writing a full `CarConfig` preset
4. No validation — typos or wrong positions cause silent runtime failures

**Goal:** Turn the game itself into a car editor. Upload a GLB → auto-detect dimensions → place markers visually → export a validated `CarConfig`.

---

## 2. User Flow

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Upload GLB  │────▶│  Select Car   │────▶│  Auto-Scale  │────▶│  Place Markers│
│  (drag/drop) │     │  from DB      │     │  & Detect    │     │  (click mesh) │
└─────────────┘     └──────────────┘     └──────────────┘     └──────┬───────┘
                                                                    │
                     ┌──────────────┐     ┌──────────────┐          │
                     │  Download     │◀────│  Validate &  │◀─────────┘
                     │  CarConfig    │     │  Export      │
                     └──────────────┘     └──────────────┘
```

### Detailed Steps

```
1. USER uploads GLB (drag-drop or file picker)
   │
   ├─ Server: store in ASSET_DIR/pending/{hash}.glb
   ├─ Server: compute SHA256, create asset record
   │
2. CLIENT loads GLB into Three.js scene (wireframe preview)
   │
   ├─ Auto-compute bounding box (L × W × H in Blender units)
   ├─ Show dimension overlay on model
   │
3. USER types car name (e.g. "AE86 Trueno")
   │
   ├─ Server: fuzzy search car_metadata DB
   ├─ Show matches with real-world dimensions (L/W/H/wheelbase/track)
   │
4. USER selects a match
   │
   ├─ Compute scale factor: real_dim / model_dim (per axis or uniform)
   ├─ Apply scale, show ghost overlay of expected bounding box
   ├─ USER confirms scale or tweaks sliders
   │
5. AUTO-DETECT markers
   │
   ├─ Scan for cylindrical meshes → suggest wheel positions
   ├─ Scan for emissive materials / "*light*" names → suggest light markers
   ├─ Place colored spheres at suggested positions
   │
6. USER places/adjusts markers
   │
   ├─ Click model surface → place marker at hit point
   ├─ Drag markers with TransformControls
   ├─ Snap-to-vertex toggle
   ├─ Required: PhysicsMarker, 4× Wheel, 2× Headlight, 2× Taillight
   ├─ Optional: Exhaust L/R, BrakeDisc
   │
7. VALIDATE
   │
   ├─ All required markers present?
   ├─ Wheel rectangle plausibility check
   ├─ PhysicsMarker near body center?
   ├─ Wheel radii consistent?
   │
8. EXPORT
   │
   ├─ Generate CarModelSchema (marker names = generated IDs, not GLB nodes)
   ├─ Generate CarConfig (scale, chassis dims derived from markers)
   ├─ Save to car_configs DB table
   ├─ Mark asset status = ready
   ├─ User can download JSON or copy to clipboard
```

---

## 3. Technical Architecture

### 3.1 Stack

| Layer | Tech | Notes |
|-------|------|-------|
| Frontend | Vanilla TS + Three.js | Game already uses Three.js + Lit; no React needed |
| Editor UI | Lit web components | Consistent with existing game UI |
| 3D Controls | Three.js `TransformControls` + `OrbitControls` | Move/snap markers in 3D |
| Backend | Express 5 | Already in package.json |
| Storage | Local filesystem | `ASSET_DIR` env var (default `./assets/uploads`) |
| Hash DB | JSON file or SQLite | Asset metadata, car_metadata lookup |

### 3.2 File Structure (new files)

```
src/
├── client/
│   └── editor/
│       ├── editor-main.ts          # Entry point, editor scene setup
│       ├── editor-ui.ts            # Lit components for editor panels
│       ├── marker-tool.ts          # Raycasting, marker placement, snap
│       ├── auto-detect.ts          # Wheel/light/shape detection
│       ├── dimension-overlay.ts    # Bounding box visualization
│       └── export.ts              # Config generation + download
├── server/
│   ├── assets.ts                   # Upload, storage, hash check
│   └── car-db.ts                   # Car metadata search, config save
public/
└── editor.html                     # Separate entry point for editor mode
```

### 3.3 Routes & Endpoints

**New server routes (added to `src/server/index.ts`):**

```
POST   /api/assets/upload          Upload GLB, returns { hash, assetId }
GET    /api/assets                  List all assets (with status filter)
GET    /api/assets/:id              Get asset metadata + config if ready
GET    /api/cars/search?q=ae86      Fuzzy search car_metadata
POST   /api/cars/config             Save CarConfig + CarModelSchema
GET    /api/cars/config/:id         Get saved config
GET    /api/pending-assets          Assets with status=pending
```

**Frontend routes:**
- `/editor.html` — standalone editor page (separate Vite entry)
- Can also be reached from garage mode: "Edit Model" button

### 3.4 Asset Storage Layout

```
ASSET_DIR/
├── pending/
│   └── {sha256}.glb          # Raw uploads awaiting processing
├── ready/
│   └── {sha256}.glb          # Processed, linked to a car config
├── thumbnails/
│   └── {sha256}.png          # Auto-generated preview
└── db/
    ├── assets.json            # { hash, status, uploadedAt, carConfigId? }
    └── car_metadata.json      # Real-world car dimensions database
```

---

## 4. Upload & Import

### 4.1 Server Side

```typescript
// POST /api/assets/upload
// - Accepts multipart/form-data with file field "model"
// - Computes SHA256 of file bytes
// - Checks assets.json for existing hash
//   - If exists: return existing asset (idempotent)
//   - If new: save to ASSET_DIR/pending/{hash}.glb, create record
// - Serves the GLB at /api/assets/{hash}/file for client loading
```

### 4.2 Client Side

```typescript
// Uses Three.js GLTFLoader to load from /api/assets/{hash}/file
// Renders in editor scene with:
//   - Grid floor (50m × 50m)
//   - Ambient + directional light
//   - OrbitControls for camera
//   - Wireframe toggle for inner structure
```

---

## 5. Auto-Detection & Scaling

### 5.1 Dimension Extraction

```typescript
// After loading GLB:
const box = new THREE.Box3().setFromObject(model);
const size = box.getSize(new THREE.Vector3());
// size.x = width, size.y = height, size.z = length (Blender convention)
// Display as overlay: "4.2m × 1.8m × 1.4m"
```

### 5.2 Car Metadata Database

```typescript
interface CarMetadata {
  name: string;
  /** Alternative names / aliases for fuzzy search */
  aliases: string[];
  /** Real-world dimensions in meters */
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  wheelRadius: number;    // approx tire outer radius
  mass: number;           // curb weight kg
  /** Year range for disambiguation */
  yearFrom?: number;
  yearTo?: number;
}
```

**Scale computation:**

```typescript
// Uniform scale (preserves proportions):
const scaleX = realWidth / modelWidth;
const scaleY = realHeight / modelHeight;
const scaleZ = realLength / modelLength;
// Use median to handle slight model inaccuracies
const uniformScale = median(scaleX, scaleY, scaleZ);
// Or per-axis if model is intentionally non-uniform
```

### 5.3 Dimension Overlay

```
         ┌──────── 4.2m (expected: 4.3m) ────────┐
         │                                         │
         │           ┌─────────────────┐           │
    1.4m │           │                 │  1.4m     │
 (1.35m) │           │    CAR MODEL    │  (1.35m)  │
         │           │                 │           │
         │           └─────────────────┘           │
         │                                         │
         └─────────────────────────────────────────┘
                     1.8m (expected: 1.7m)

         Green = actual    Red dashed = expected (from DB)
```

---

## 6. Marker Placement Tool

### 6.1 Marker Types

| Marker | Color | Required | Description |
|--------|-------|----------|-------------|
| `PhysicsMarker` | 🔵 Blue | Yes | CG reference point, defines physics origin |
| `Wheel_FL` | 🟢 Green | Yes | Front-left wheel center |
| `Wheel_FR` | 🟢 Green | Yes | Front-right wheel center |
| `Wheel_RL` | 🟡 Yellow | Yes | Rear-left wheel center |
| `Wheel_RR` | 🟡 Yellow | Yes | Rear-right wheel center |
| `Headlight_L` | ⚪ White | Yes | Left headlight position |
| `Headlight_R` | ⚪ White | Yes | Right headlight position |
| `Taillight_L` | 🔴 Red | Yes | Left taillight position |
| `Taillight_R` | 🔴 Red | Yes | Right taillight position |
| `Exhaust_L` | 🟠 Orange | No | Left exhaust pipe |
| `Exhaust_R` | 🟠 Orange | No | Right exhaust pipe |
| `BrakeDisc` | 🟣 Purple | No | Brake disc reference (material name match) |

### 6.2 Placement Mode

```
Editor modes:
┌──────────────┬─────────────────────────────────────┐
│ Mode         │ Behavior                            │
├──────────────┼─────────────────────────────────────┤
│ ORBIT        │ Default. Camera rotates, no placing. │
│ PLACE        │ Click mesh → place selected marker   │
│ MOVE         │ Click existing marker → drag it      │
│ DELETE       │ Click marker → remove it             │
│ SNAP-VERTEX  │ Like PLACE but snaps to nearest vert │
└──────────────┴─────────────────────────────────────┘
```

### 6.3 Implementation

```typescript
// Raycasting for placement:
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onCanvasClick(event: MouseEvent) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(model, true);
  if (intersects.length > 0) {
    placeMarker(currentMarkerType, intersects[0].point);
  }
}

// TransformControls for moving placed markers:
const transformControls = new THREE.TransformControls(camera, renderer.domElement);
// Attach to selected marker for translation (not rotation/scale)
```

### 6.4 Auto-Detection

**Wheel detection:**
```typescript
function detectWheels(model: THREE.Object3D): WheelCandidate[] {
  const candidates: WheelCandidate[] = [];
  model.traverse((child) => {
    if (!child.isMesh) return;
    const geo = child.geometry;
    const box = new THREE.Box3().setFromObject(child);
    const size = box.getSize(new THREE.Vector3());
    // Wheels are roughly disc-shaped: one axis much shorter than the other two
    const sorted = [size.x, size.y, size.z].sort((a, b) => a - b);
    const aspectRatio = sorted[0] / sorted[1]; // thin axis / medium axis
    const circularity = sorted[1] / sorted[2]; // medium axis / long axis
    if (aspectRatio < 0.5 && circularity > 0.7) {
      candidates.push({
        mesh: child,
        center: box.getCenter(new THREE.Vector3()),
        radius: sorted[2] / 2,
        thinAxis: size.x < size.y ? (size.x < size.z ? 'x' : 'z') : 'y',
      });
    }
  });
  return candidates;
}
```

**Light detection:**
```typescript
function detectLights(model: THREE.Object3D): LightCandidate[] {
  const candidates: LightCandidate[] = [];
  model.traverse((child) => {
    if (!child.isMesh) return;
    const name = child.name.toLowerCase();
    // Check material for emissive
    const mat = child.material;
    if (mat.emissive && mat.emissiveIntensity > 0) {
      candidates.push({ mesh: child, type: 'emissive' });
    }
    // Check name patterns
    if (name.includes('headlight') || name.includes('head_light') || name.includes('front_light')) {
      candidates.push({ mesh: child, type: 'headlight' });
    }
    if (name.includes('taillight') || name.includes('tail_light') || name.includes('rear_light') || name.includes('back_light')) {
      candidates.push({ mesh: child, type: 'taillight' });
    }
  });
  return candidates;
}
```

---

## 7. Validation & Export

### 7.1 Validation Rules

```typescript
interface ValidationResult {
  errors: string[];   // Must fix before export
  warnings: string[]; // Should review but can export
}

function validateConfig(markers: MarkerMap): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required markers
  const required = ['PhysicsMarker', 'Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR',
                     'Headlight_L', 'Headlight_R', 'Taillight_L', 'Taillight_R'];
  for (const name of required) {
    if (!markers[name]) errors.push(`Missing required marker: ${name}`);
  }

  // Wheel rectangle check
  const fl = markers.Wheel_FL, fr = markers.Wheel_FR;
  const rl = markers.Wheel_RL, rr = markers.Wheel_RR;
  if (fl && fr && rl && rr) {
    // Front pair should have similar Z (forward/back)
    if (Math.abs(fl.z - fr.z) > 0.05) errors.push("Front wheels not aligned on Z axis");
    // Rear pair similar
    if (Math.abs(rl.z - rr.z) > 0.05) errors.push("Rear wheels not aligned on Z axis");
    // Same track width front/rear (X spacing)
    const frontTrack = Math.abs(fl.x - fr.x);
    const rearTrack = Math.abs(rl.x - rr.x);
    if (Math.abs(frontTrack - rearTrack) / frontTrack > 0.3) {
      warnings.push(`Track width mismatch: front=${frontTrack.toFixed(2)}m rear=${rearTrack.toFixed(2)}m`);
    }
    // Left pair similar X
    if (Math.abs(fl.x - rl.x) > 0.05) warnings.push("Left wheels not aligned on X axis");
  }

  // PhysicsMarker near center
  if (markers.PhysicsMarker) {
    const center = new THREE.Vector3();
    new THREE.Box3().setFromObject(model).getCenter(center);
    const dist = markers.PhysicsMarker.distanceTo(center);
    if (dist > 0.5) warnings.push(`PhysicsMarker is ${dist.toFixed(2)}m from body center`);
  }

  // Wheel radii consistency (if auto-detected)
  // ...

  return { errors, warnings };
}
```

### 7.2 Export Format

The export generates both a `CarModelSchema` and a `CarConfig`:

```jsonc
{
  // CarModelSchema — marker/node mapping
  "modelSchema": {
    "wheelModelPath": "/assets/uploads/{hash}.glb#auto_wheel",  // extracted wheel mesh
    "markers": {
      "physicsMarker": "PhysicsMarker",
      "wheels": ["WheelRig_FL", "WheelRig_FR", "WheelRig_RL", "WheelRig_RR"],
      "escapePipes": { "left": "Exhaust_L", "right": "Exhaust_R" }
    },
    "materials": {
      "headlight": "auto_headlight_L",
      "taillight": "auto_taillight_L"
    },
    "wheelTemplateNode": "auto_wheel",
    "brakeDiscMaterials": ["auto_brakedisc"]
  },
  // CarConfig — derived physics config
  "carConfig": {
    "name": "Toyota AE86 Trueno",
    "modelPath": "/assets/uploads/{hash}.glb",
    "modelScale": 1.23,
    "engine": { /* from DB or user input */ },
    "gearbox": { /* from DB or user input */ },
    "brakes": { /* from DB or user input */ },
    "tires": { /* from DB or user input */ },
    "drag": { /* from DB or user input */ },
    "chassis": {
      "mass": 940,
      "halfExtents": [0.85, 0.55, 2.1],  // derived from markers
      "wheelRadius": 0.31,               // from wheel markers
      "wheelPositions": [
        { "x": -0.72, "y": 0.0, "z": 1.2 },   // FL
        { "x":  0.72, "y": 0.0, "z": 1.2 },   // FR
        { "x": -0.72, "y": 0.0, "z": -1.0 },  // RL
        { "x":  0.72, "y": 0.0, "z": -1.0 }   // RR
      ],
      "wheelBase": 2.2,           // derived: FL.z - RL.z
      "maxSteerAngle": 0.52,      // from DB or default
      "suspensionStiffness": 50,
      "suspensionRestLength": 0.3,
      "dampingRelaxation": 2.3,
      "dampingCompression": 4.4,
      "rollInfluence": 0.1,
      "maxSuspensionTravel": 0.3,
      "cgHeight": 0.45            // from PhysicsMarker.y
    }
  }
}
```

**Key insight:** Since we're generating marker positions from the editor (not relying on GLB node names), the `CarModelSchema` can use generated/renamed node names. The editor essentially *creates* the naming convention that the game expects.

### 7.3 Alternative: Embed markers in GLB

Instead of relying on node names, we could embed the markers directly:
- Clone the original GLB
- Add `PhysicsMarker`, `WheelRig_*` etc. as empty `Object3D` nodes at the placed positions
- Re-export as a new GLB
- The game loads this "prepared" GLB with standard node names

This approach means `DEFAULT_CAR_MODEL_SCHEMA` works unchanged. The trade-off is an extra export step but zero game code changes.

---

## 8. Integration with Existing Game

### 8.1 Garage Mode

The garage (`garage-store.ts`) already stores `TunableConfig` to localStorage. The editor extends this:

```
Garage UI
├── Car selector dropdown
│   ├── Built-in presets (RACE_CAR, SEDAN_CAR, SPORTS_CAR)
│   └── Custom cars (from DB)
├── Tune sliders (engine, gearbox, etc.)
├── Visual preview (car model in scene)
└── [+ Import New Car] button
        │
        └── Opens /editor.html in same tab
            (or modal overlay with editor scene)
```

### 8.2 Editor Entry Points

1. **Garage "Import" button** → navigates to `/editor.html`
2. **Direct URL** `/editor.html?asset={hash}` → resume editing a pending asset
3. **Admin/debug** → `/editor.html?debug` → extra wireframe/info overlays

### 8.3 Game Loading

The game's `VehicleRenderer` currently loads a GLB and uses `CarModelSchema.markers` to find nodes by name. Two options:

**Option A: Rename nodes in exported GLB** (recommended)
- Editor embeds standard-named empty nodes into the GLB
- Game code unchanged — `DEFAULT_CAR_MODEL_SCHEMA` works
- One file per car, self-contained

**Option B: Store marker positions in DB, apply at runtime**
- Game loads original GLB, queries DB for marker offsets
- Adds `Object3D` nodes at stored positions
- More flexible (can tweak without re-exporting GLB)
- Requires game code change in `VehicleRenderer`

### 8.4 Car Metadata Source

Initially a static JSON file. Future sources:
- User-contributed entries
- Wikipedia API lookup (car infobox dimensions)
- Existing databases: cars-data API, automobile-catalog.com

Seed data: ~50 popular JDM + Euro cars with real dimensions.

---

## 9. NPM Packages

| Package | Purpose | Status |
|---------|---------|--------|
| `three` | 3D rendering | ✅ Already installed |
| `three-mesh-bvh` | Accelerated raycasting, BVH for collision | **Add** — faster raycasting for marker placement |
| `gltf-transform` | glTF/GLB manipulation, node injection, optimization | **Add** — embed markers into GLB for export |
| `@gltf-transform/extensions` | glTF extensions support | **Add** — if using extras for metadata |
| `multer` | Multipart file upload (Express middleware) | **Add** — file upload handling |
| `fuse.js` | Fuzzy search for car name matching | **Add** — search car_metadata |
| `nanoid` | Short unique IDs for markers | Optional — could use counter |
| `three/examples/jsm/controls/TransformControls` | Move markers in 3D | ✅ Already in three |

### Convex Hull

`three-mesh-bvh` includes `MeshBVH` which can compute tight bounding volumes. For full convex hull:

```typescript
// Option 1: Use three-mesh-bvh for accelerated intersection (sufficient for our needs)
import { MeshBVH } from 'three-mesh-bvh';

// Option 2: Implement quickhull for actual convex hull (only if needed for volume/mass calc)
// A simple 3D convex hull in JS is ~200 lines; not needed unless we want precise volume estimation
```

For this use case, **axis-aligned bounding box is sufficient** for scale computation. Convex hull is only needed if we want precise volume → mass estimation.

---

## 10. Editor UI Layout

```
┌────────────────────────────────────────────────────────────────────┐
│  🚗 Car Model Editor                              [Export] [Help] │
├──────────┬─────────────────────────────────────────┬──────────────┤
│          │                                         │              │
│  UPLOAD  │                                         │   MARKER     │
│  ──────  │                                         │   LIST       │
│  [Drop]  │         THREE.JS VIEWPORT               │   ─────────  │
│          │                                         │   🔵 Phys    │
│  CAR DB  │         (model + grid + markers)        │   🟢 FL  FR  │
│  ──────  │                                         │   🟡 RL  RR  │
│  Search: │                                         │   ⚪ HL  HR  │
│  [____]  │                                         │   🔴 TL  TR  │
│  > AE86  │                                         │   🟠 EX  EX  │
│  > Supra │                                         │              │
│          │                                         │   TOOLS      │
│  SCALE   │                                         │   ─────────  │
│  ──────  │                                         │   [Orbit]    │
│  X: 1.23 │                                         │   [Place]    │
│  Y: 1.23 │                                         │   [Move]     │
│  Z: 1.23 │                                         │   [Delete]   │
│  [Lock]  │                                         │   [☑ Snap]   │
│          │                                         │              │
│  INFO    │                                         │   VALIDATE   │
│  ──────  │                                         │   ─────────  │
│  4.2×1.8 │                                         │   ✅ 9/9 req │
│  ×1.4m   │                                         │   ⚠ 1 warn  │
│          │                                         │              │
├──────────┴─────────────────────────────────────────┴──────────────┤
│  Status: Auto-detected 4 wheel candidates, 2 headlight meshes    │
└────────────────────────────────────────────────────────────────────┘
```

---

## 11. Implementation Phases

### Phase 1: Upload & View (Minimal Viable Editor)
- File upload endpoint + GLB loading in editor scene
- Bounding box computation + dimension display
- OrbitControls + wireframe toggle
- **Deliverable:** Can upload a GLB and see it in 3D with dimensions

### Phase 2: Scale & Car DB
- Car metadata JSON with ~20 seed entries
- Fuzzy search UI
- Scale computation + slider adjustment
- Dimension overlay (expected vs actual)
- **Deliverable:** Can select a real car, auto-scale the model

### Phase 3: Marker Placement
- Raycasting placement + TransformControls movement
- All 12 marker types with colored visuals
- Snap-to-vertex mode
- Marker list panel with click-to-select
- **Deliverable:** Can manually place all markers on a model

### Phase 4: Auto-Detection
- Wheel detection (cylindrical mesh scanning)
- Light detection (emissive materials + name patterns)
- Auto-place markers with visual suggestions
- **Deliverable:** Most markers auto-detected, user confirms/adjusts

### Phase 5: Validation & Export
- Validation rules (required markers, geometry checks)
- Export CarConfig + CarModelSchema as JSON
- Save to DB, mark asset ready
- GLB node embedding (Option A from §8.3)
- **Deliverable:** Complete pipeline from GLB to playable car

### Phase 6: Game Integration
- Garage "Import" button → editor flow
- Game loads editor-prepared GLBs
- Custom car selection in garage
- **Deliverable:** End-to-end: upload → edit → play

---

## 12. Open Questions

1. **GLB modification vs. sidecar JSON?** Embedding markers in GLB is cleaner for the game (one file) but requires `gltf-transform`. Sidecar JSON is simpler but needs game code changes. **Recommendation: embed in GLB.**

2. **Per-axis vs uniform scaling?** Most car models are proportionally correct; uniform scale is simpler. Per-axis lets you fix squished models but may look wrong. **Recommendation: default uniform, allow per-axis toggle.**

3. **Multiple meshes per car?** Some models split body/parts into separate meshes. The editor should handle merged and multi-mesh GLBs. **Recommendation: traverse entire scene graph for detection, let user see all meshes.**

4. **Material detection for lights?** Not all models use emissive materials for lights. Some use plain white/colored materials. **Recommendation: combine emissive detection + name matching + manual override.**

5. **Database choice?** JSON file is simplest for a small project. SQLite for production. **Recommendation: start with JSON files, migrate to SQLite if needed.**
