# Procedural Terrain Generation Research

## Problem Statement

We have a procedural closed-loop road (Catmull-Rom spline, ~1000 samples). The world is currently flat (a ground plane at a fixed Y). We need to generate terrain that:

1. **Conforms to the road** — terrain height matches road elevation where the road passes
2. **Is deterministic** — same seed → same terrain, generated entirely in the browser
3. **Looks interesting** — mountains, valleys, variation, not flat
4. **Has sensible texturing** — grass, rock, snow based on slope/elevation
5. **Performs well** — browser/Three.js, no GPU compute shaders

### Key Constraint

The road is a thin strip through the world. Terrain must blend smoothly from road-level at the strip to free-form mountains/valleys elsewhere. The road should appear to sit naturally ON the terrain, not float above or cut through it.

---

## Approaches Evaluated

### 1. Heightmap with Road-Strip Falloff (RECOMMENDED)

**How it works:**
- Generate a 2D noise heightmap covering the world (Simplex/Perlin noise, multi-octave)
- For each heightmap vertex, compute distance to nearest road sample point
- Blend between the noise height and the road elevation using a smooth falloff:
  - Near road: terrain = road elevation (road sits flush)
  - Far from road: terrain = noise height (free-form mountains)
  - Transition zone: smooth interpolation (e.g., `smoothstep` over ~20-50m)

**Why it fits our case:**
- Deterministic — noise function seeded with same seed as track
- Client-side only — no server changes needed
- Simple to implement — `simplex-noise` npm package (2KB, 70M ops/sec)
- Road always sits flush on terrain — no floating or clipping
- Mountains/valleys appear naturally in the distance
- Works with our existing track samples as control points

**Implementation sketch:**
```
for each terrain vertex (x, z):
  noiseHeight = fbm(noise2D, x * scale, z * scale, octaves) * amplitude
  roadDist = minDistanceToRoad(x, z)  // from precomputed samples
  roadHeight = interpolateRoadHeight(x, z)  // from nearest samples
  blend = smoothstep(roadDist, 10, 40)  // 0 at road, 1 at 40m out
  terrainY = lerp(roadHeight, noiseHeight, blend)
```

**Spatial index for nearest-road lookup:**
- Build a grid hash (e.g., 10m cells) mapping cell → list of nearby samples
- O(1) nearest-sample lookup instead of O(n) linear scan
- Or use a kd-tree (`lbush` npm, 3KB)

**References:**
- [Red Blob Games — Making maps with noise](https://www.redblobgames.com/maps/terrain-from-noise/)
- [simplex-noise.js](https://github.com/jwagner/simplex-noise.js) — 2KB, zero deps, seeded PRNG support
- [Inigo Quilez — More Noise](https://iquilezles.org/articles/morenoise/) — fbm with analytic normals

**Potential issues:**
- If noise height differs wildly from road height at the transition zone, terrain can have steep/unrealistic slopes. Solution: clamp the noise height near the road to be within a reasonable range of road height, or use the noise height as an *offset* from road height rather than a replacement.

**Variation: Noise as offset from road height**
```
terrainY = roadHeight + noiseHeight * blend
```
This ensures terrain always starts at road level and adds variation outward. Mountains still form far from the road. The road never clips.

---

### 2. Density Function + Marching Cubes

**How it works:**
- Define a 3D density function `density(x, y, z)` — positive = solid, negative = air
- Surface is where density = 0 (isosurface)
- Marching cubes algorithm extracts triangle mesh from the density field
- Can produce overhangs, caves, cliffs — not limited to heightmaps

**Why it's powerful:**
- Produces realistic terrain with caves, overhangs, arches
- GPU Gems 3 Chapter 1 describes GPU-accelerated version
- Infinite terrain generation possible (generate chunks on demand)

**Why it's NOT recommended for us (yet):**
- Computationally expensive — 32³ voxel grid per chunk, lots of mesh extraction
- Harder to constrain to road — density function must be carefully crafted so the road sits on the surface
- Complex to implement correctly (256-case lookup tables, vertex interpolation)
- Overkill for a racing game where you mainly see terrain from road level
- Better suited for exploration/fps games

**References:**
- [GPU Gems 3 Ch.1 — Generating Complex Procedural Terrains Using GPU](https://developer.nvidia.com/gpugems/GPUGems3/gpugems3_ch01.html)
- [Inigo Quilez — Terrain Marching](https://iquilezles.org/articles/terrainmarching/)

---

### 3. Diamond-Square Algorithm

**How it works:**
- Start with a square grid, seed the corners with random heights
- Recursively subdivide: midpoints get averaged ± random displacement
- Produces natural-looking heightmaps in O(n²)

**Why it's NOT recommended:**
- Requires a power-of-2 grid size — doesn't fit our arbitrary world bounds
- Not easily seedable in a way that's deterministic with our track seed
- No continuous coordinate input — you can't query height at arbitrary (x,z)
- Superseded by noise-based approaches for most use cases

---

### 4. Raymarched Terrain (Shader-based)

**How it works:**
- No mesh at all — terrain is a function `y = f(x, z)` evaluated in a fragment shader
- Camera ray is stepped through the scene, testing against the height function
- Normals computed analytically from noise derivatives

**Why it's NOT recommended:**
- Purely GPU-based — we can't collide cars against a shader
- No mesh data for physics, AI pathfinding, or scenery placement
- Would need a separate CPU-side heightmap anyway for gameplay
- Cool for demos (Shadertoy), impractical for a game

**References:**
- [Inigo Quilez — Terrain Marching](https://iquilezles.org/articles/terrainmarching/)
- [Shadertoy — Elevated](https://www.shadertoy.com/view/4ttSWf)

---

### 5. Pre-built Terrain Tile System

**How it works:**
- Hand-crafted terrain tiles (heightmaps) in a tileset
- Tiles placed by the procedural generator
- Different biomes/regions use different tile sets

**Why it's NOT recommended:**
- Requires art assets we don't have
- Less variety than procedural noise
- Harder to blend with arbitrary road paths

---

## Texturing Strategy

Once we have a heightmap, we need textures that make sense:

### Slope-based texturing
- **Flat areas** → grass
- **Moderate slopes** → dirt/rock
- **Steep slopes/cliffs** → bare rock
- Compute slope from terrain normal: `slope = 1.0 - normal.y`

### Elevation-based texturing
- **Low** → grass/meadow
- **Medium** → forest/rock
- **High** → snow

### Tri-planar mapping (recommended for steep terrain)
- Projects texture from 3 axes (top, side, front) and blends by normal
- Prevents texture stretching on cliffs and overhangs
- Three.js doesn't have built-in support but can be done with a custom shader

### Canvas-based procedural textures (our current approach)
- Generate grass, dirt, rock textures on `<canvas>` elements
- Tile them across the terrain based on biome
- Simpler than tri-planar, good enough for most angles

### References
- [Red Blob Games — Biomes](https://www.redblobgames.com/maps/terrain-from-noise/#biomes) — elevation + moisture biome selection
- [Three.js Heightmap](https://github.com/mrdoob/three.js/wiki/Heightmap) — basic Three.js heightmap approach

---

## Recommended Implementation Plan

### Phase 1: Basic Terrain Heightmap
1. Install `simplex-noise` (2KB, zero deps)
2. Create `src/shared/terrain.ts` — pure math, no Three.js dependency
3. Generate 2D heightmap using multi-octave simplex noise (fbm)
4. For each vertex, blend noise height with road elevation using distance falloff
5. Use `smoothstep` for smooth transitions
6. Precompute nearest-road-sample lookup grid for fast distance queries

### Phase 2: Terrain Mesh
1. Create `src/client/terrain.ts` — Three.js terrain mesh builder
2. Generate `PlaneGeometry` sized to world bounds
3. Apply heightmap to vertex positions
4. Compute normals for lighting
5. Apply slope/elevation-based vertex colors or material

### Phase 3: Texturing
1. Procedural grass texture (canvas-generated, like our road texture)
2. Rock texture for steep slopes
3. Snow texture for high elevations
4. Blend based on slope + elevation (vertex colors or custom shader)

### Phase 4: Optimization
1. LOD (Level of Detail) — reduce vertex count far from camera
2. Chunk-based loading — only generate terrain chunks near the player
3. Cache generated chunks
4. Consider `THREE.LOD` or chunked terrain with frustum culling

---

## Noise Libraries Evaluated

| Library | Size | Speed | Seeded? | Notes |
|---------|------|-------|---------|-------|
| [simplex-noise](https://github.com/jwagner/simplex-noise.js) | ~2KB | 70M ops/s | Yes (via PRNG arg) | **Recommended**. Zero deps, tree-shakeable, TS support |
| [open-simplex-noise](https://github.com/jwagner/open-simplex-noise) | ~3KB | 50M ops/s | Yes | Older API |
| Custom Perlin (mulberry32 + lerp) | 0KB (we have it) | Slow | Yes | What we already use for track gen — could extend |

**Decision:** Use `simplex-noise` — it's the standard, fast, and supports seeding with our existing PRNG (`alea` or pass `mulberry32` as the PRNG function).

---

## Key References

- [Red Blob Games — Making maps with noise](https://www.redblobgames.com/maps/terrain-from-noise/) — Best intro to noise-based terrain
- [Inigo Quilez — More Noise](https://iquilezles.org/articles/morenoise/) — Advanced fbm with analytic normals
- [Inigo Quilez — Terrain Marching](https://iquilezles.org/articles/terrainmarching/) — Raymarched terrain
- [GPU Gems 3 Ch.1](https://developer.nvidia.com/gpugems/GPUGems3/gpugems3_ch01.html) — Marching cubes terrain
- [simplex-noise.js](https://github.com/jwagner/simplex-noise.js) — Noise library
- [Three.js Heightmap Wiki](https://github.com/mrdoob/three.js/wiki/Heightmap) — Basic heightmap in Three.js
- [Wikipedia — Simplex Noise](https://en.wikipedia.org/wiki/Simplex_noise) — Algorithm theory
