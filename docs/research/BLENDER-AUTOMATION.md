# Blender Automation Research

**Date:** 2026-04-16
**Status:** ✅ Blender works headlessly

## Findings

### Blender Installation
- **Installed:** Blender 4.0.2 via `apt install blender`
- **Headless mode:** Works perfectly (`blender --background`)
- **glTF I/O:** Import and export both work (GLB format)
- **Minor issue:** Draco compression not available (non-critical; GLB exports fine without it)

### No Blender Skill
- No OpenClaw skill exists for Blender (checked `/usr/lib/node_modules/openclaw/skills/`)

### Script Created
- **`scripts/add-markers.py`** — Adds physics marker empty objects to GLB car models
- Adds: `PhysicsMarker` (bottom center), `WheelRig_FrontLeft/Right`, `WheelRig_RearLeft/Right`
- Wheel positions estimated from bounding box geometry
- Usage: `blender --background --python add-markers.py -- input.glb output.glb`

### Test Results
- Tested on `car_red.glb` (vintage racer model)
- Bounding box: 0.55 × 0.875 × 0.325 units
- Successfully exported with markers to `/tmp/car_red-marked.glb`

### Available Car Models
```
racing-game/web-racing/frontend/public/models/
  car_indigo.glb, car_green.glb, car_orange.glb, car_violet.glb
  car_red.glb, car_blue.glb, vehicle-vintage-racer.glb
```

## Alternatives (if Blender unavailable)
- **gltf-transform** (npm) — programmatic GLB manipulation, can add nodes/extensions
- **three.js** — parse GLB, compute bounds, add marker nodes, export back
- Blender is the best option since it handles all 3D transforms correctly
