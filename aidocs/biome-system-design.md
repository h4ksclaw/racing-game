# Biome System Design

## Overview
Procedural biome system that selects a biome based on seed, then applies a consistent set of rules for terrain coloring, textures, tree types, plant types, and density. Each biome is a "theme" — a set of configuration values.

## Texture Sources (CC0)

### AmbientCG (https://ambientcg.com)
Each texture comes with: Color (albedo), Normal, Roughness, AO, Displacement maps.
Format: `1K-JPG` zips (~3-10MB each), contains individual JPG files.

**Recommended textures per biome:**

| Texture | AmbientCG ID | Use |
|---------|-------------|-----|
| **Temperate Forest** | | |
| Lush grass | Grass004 | Terrain near track |
| Forest floor (leaves/sticks) | Ground023 | Terrain mid-distance |
| Mossy ground | Ground037 | Terrain with moss patches |
| Dirt path | Ground048 | Track shoulders |
| Bark | Bark001 | Tree trunk detail |
| **Desert / Arid** | | |
| Sand | Ground054 | Terrain base |
| Gravel | Gravel023 | Track edges |
| Rock cliff | Rock029 | Mountains |
| Dry dirt | Ground036 | Mud patches |
| **Alpine / Snow** | | |
| Snow | Snow010A | Terrain high elevation |
| Rock | Rock035 | Cliffs |
| Gravel | Rocks022 | Track edges |
| Mossy rock | Ground068 | Mid-elevation |
| **Tropical / Jungle** | | |
| Dense grass | Grass001 | Terrain base |
| Forest floor | Ground038 | With branches |
| Moss | Moss002 | Wet areas |
| Dirt/mud | Ground054 | Patches |

### Road Textures
| Texture | AmbientCG ID | Use |
|---------|-------------|-----|
| Modern road with markings | Road007 | Fresh asphalt |
| Damaged road | Asphalt019 | Worn sections |
| Smooth asphalt | Asphalt023S | Clean track |
| Dark wet asphalt | Asphalt025C | Rain effect |
| Paving stones | PavingStones054 | Alternate road style |

## 3D Asset Packs (CC0)

### Current: Kenney "Nature Pack" (decorations.glb)
44 model types: trees (pine, default), rocks, stones, grass, mushrooms, pumpkins, stumps, logs, gates, lights.

### Additional Kenney Packs to Consider
- **Nature Pack Extended** — More tree varieties (palm, willow, birch), bushes, flowers
- **City Pack** — Buildings, fences, signs (for urban biome)
- **Vehicle Pack** — Cars for reference/obstacles
- **Farm Pack** — Hay bales, fences, barns (for rural biome)
- **Desert Pack** — Cacti, rocks, ruins

### Other Sources
- **Quaternius** (https://quaternius.com) — Free low-poly 3D packs (town, nature, vehicles)
- **Poly Pizza** (https://poly.pizza) — CC0 low-poly models, API searchable
- **Sketchfab** — CC0/CC-BY models (check license per model)

## Biome Definitions

```typescript
interface BiomeConfig {
  name: string;
  
  // Terrain
  terrainColor: {
    nearTrack: [number, number, number];    // RGB near road
    midDistance: [number, number, number];   // RGB 20-100m from road
    farDistance: [number, number, number];   // RGB 100m+ from road
    rock: [number, number, number];         // Rocky/slope areas
    snow: [number, number, number];         // High elevation
    colorNoiseIntensity: number;            // How much color variation
  };
  
  // Road
  roadTexture: 'asphalt' | 'gravel' | 'dirt' | 'paving';
  roadColor: [number, number, number];
  
  // Vegetation
  treeTypes: SceneryType[];          // Which tree models to use
  treeDensity: number;               // 0.0-2.0 multiplier
  treeScaleRange: [number, number];  // Min/max scale
  grassTypes: SceneryType[];         // Which grass/plant models
  grassDensity: number;
  
  // Features
  rockDensity: number;
  mushroomGroveChance: number;       // 0-1
  pumpkinClusterChance: number;      // 0-1
  
  // Atmosphere
  fogColor: [number, number, number];
  fogDensity: number;
  ambientLightColor: [number, number, number];
  ambientLightIntensity: number;
  sunColor: [number, number, number];
  sunIntensity: number;
  
  // Terrain height
  mountainAmplifier: number;         // How much mountains rise at edges
  terrainNoiseAmp: number;           // Base noise amplitude
}
```

## Proposed Biomes

### 1. Temperate Forest (default)
- Dense pine/mixed trees, lush green grass, forest floor with leaves
- Road: Clean asphalt with white markings
- Fog: Light green-white, low density
- Mountains: Moderate (3x at edges)

### 2. Autumn Woods
- Orange/red/yellow tinted trees, brown ground with fallen leaves
- Road: Slightly worn asphalt
- Fog: Warm golden haze
- Mountains: Moderate

### 3. Desert Canyon
- Sparse vegetation (cacti, dead trees), sandy/rocky ground
- Road: Gravel or cracked asphalt
- Fog: Warm orange haze, medium density
- Mountains: High (5x), red/brown rock faces

### 4. Alpine Snow
- Sparse pine trees, white ground at elevation, green at lower
- Road: Dark asphalt with ice patches
- Fog: White/blue, high density
- Mountains: Very high (6x), snow-capped

### 5. Tropical Jungle
- Dense palm/exotic trees, bright green, muddy patches
- Road: Worn dirt/asphalt mix
- Fog: Light green, medium density
- Mountains: Moderate, lush

### 6. Rural Countryside
- Mixed trees, hay bales, farm fences, rolling green hills
- Road: Paving stones or smooth asphalt
- Fog: Soft white, low density
- Mountains: Gentle (2x)

## Implementation Plan

### Phase 1: Texture System
1. Download 1K-JPG texture packs from ambientCG (use 1K for web performance)
2. Extract to `public/textures/biomes/{biome}/` — color, normal, roughness, ao maps
3. Create `TextureManager` class in client — loads textures per biome, applies to terrain mesh
4. Replace vertex colors on terrain with texture-blended shader material
5. Add normal maps for surface detail

### Phase 2: Biome Selection
1. Add `BiomeConfig` interface and biome definitions
2. Seed determines biome selection (seed % numBiomes, or hash-based)
3. `generateTrack()` returns biome type alongside geometry
4. Client receives biome config, applies all settings

### Phase 3: Asset Variety
1. Download additional Kenney packs or Quaternius packs
2. Map asset types per biome (desert = cacti, alpine = snow pines, etc.)
3. Adjust `generateScenery()` to use biome-specific type lists

### Phase 4: Visual Polish
1. Fog per biome (color, density, near/far)
2. Lighting per biome (sun angle, color, intensity, ambient)
3. Sky color matching
4. Post-processing (bloom for tropical, SSAO for forest, etc.)

### Phase 5: Terrain Shader
Custom shader material that blends:
- Base terrain texture (biome-specific)
- Normal map for surface detail
- Slope-based rock texture blending
- Distance-based LOD (detail texture near camera, base texture far)

```glsl
// Pseudocode for terrain shader
vec4 baseColor = texture(terrainTex, uv * tiling);
vec4 rockColor = texture(rockTex, uv * tiling);
vec4 snowColor = texture(snowTex, uv * tiling);

float slopeBlend = smoothstep(0.3, 0.6, slope);
float heightBlend = smoothstep(snowLine - 10, snowLine + 10, height);

vec4 finalColor = mix(baseColor, rockColor, slopeBlend);
finalColor = mix(finalColor, snowColor, heightBlend);

// Apply normal map
vec3 normal = texture(normalTex, uv * tiling).rgb * 2.0 - 1.0;
```

## Download Script
```bash
# 1K JPG textures from ambientCG (CC0)
# Each zip contains: Color, Normal, Roughness, AO JPGs

# Temperate
curl -L -o textures/grass004_1K.zip "https://ambientcg.com/get?file=Grass004_1K-JPG.zip"
curl -L -o textures/ground023_1K.zip "https://ambientcg.com/get?file=Ground023_1K-JPG.zip"
curl -L -o textures/ground037_1K.zip "https://ambientcg.com/get?file=Ground037_1K-JPG.zip"
curl -L -o textures/ground048_1K.zip "https://ambientcg.com/get?file=Ground048_1K-JPG.zip"

# Road
curl -L -o textures/road007_1K.zip "https://ambientcg.com/get?file=Road007_1K-JPG.zip"
curl -L -o textures/asphalt019_1K.zip "https://ambientcg.com/get?file=Asphalt019_1K-JPG.zip"

# Desert
curl -L -o textures/ground054_1K.zip "https://ambientcg.com/get?file=Ground054_1K-JPG.zip"
curl -L -o textures/gravel023_1K.zip "https://ambientcg.com/get?file=Gravel023_1K-JPG.zip"
curl -L -o textures/rock029_1K.zip "https://ambientcg.com/get?file=Rock029_1K-JPG.zip"

# Snow
curl -L -o textures/snow010a_1K.zip "https://ambientcg.com/get?file=Snow010A_1K-JPG.zip"
curl -L -o textures/rock035_1K.zip "https://ambientcg.com/get?file=Rock035_1K-JPG.zip"

# Tropical
curl -L -o textures/grass001_1K.zip "https://ambientcg.com/get?file=Grass001_1K-JPG.zip"
curl -L -o textures/moss002_1K.zip "https://ambientcg.com/get?file=Moss002_1K-JPG.zip"
```

## Size Budget
- 1K-JPG texture packs: ~3-10MB each (unzipped ~15-40MB)
- For 6 biomes × 4 textures each = 24 packs = ~120-240MB total
- **Use 1K resolution** for web (2K/4K for desktop toggle later)
- Consider KTX2 compression for production (60-80% size reduction)
- Three.js `KTX2Loader` + `MeshoptDecoder` for GPU-compressed textures

## Priority Order
1. **Instanced meshes** — biggest performance win, enables more objects
2. **Texture loading system** — ambientCG 1K JPGs with normal maps
3. **Terrain shader** — texture blending instead of vertex colors
4. **Biome config** — seed-based selection with 3-4 biomes
5. **Asset variety** — additional Kenney packs per biome
6. **Atmosphere** — fog, lighting, sky color per biome
7. **Post-processing** — bloom, SSAO, color grading
