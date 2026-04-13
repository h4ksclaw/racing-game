# Sky, Lighting, and Weather System Design

## Sky Boxes / HDRIs

### Free HDRI Sources (CC0)

**Poly Haven (https://polyhaven.com/hdris)**
- 1000+ free HDRIs, CC0
- Resolution options: 1K/2K/4K/8K/16K EXR
- Categories: outdoor, sunset, overcast, night, storm, forest, desert, mountain
- Download as .hdr or .exr

**Top picks for our biomes:**

| Biome | HDRI | Why |
|-------|------|-----|
| Temperate Forest | `forest_floor` or `equirectangular` | Dappled light through trees |
| Autumn Woods | `golden_hour` or `sunset` | Warm golden light |
| Desert Canyon | `desert_sunset` or `venice_sunset` | Harsh warm light |
| Alpine Snow | `snowy_forest` or `kloofendal_48d_partly_cloudy_puresky` | Cold blue-white light |
| Tropical Jungle | `tropical_beach` or `palm_trees` | Bright warm light |
| Rural Countryside | `greenland_pier` or `drachenburg` | Soft overcast |

**Night variants:**
| Use | HDRI |
|-----|------|
| Night racing | `night_roads` or `milky_way` |
| Twilight | `dusk` or `blue_hour` |

### Three.js Implementation

```typescript
// HDRI environment map
import { RGBELoader } from 'three/examples/loaders/RGBELoader.js';

const pmremGenerator = new THREE.PMREMGenerator(renderer);
const hdri = await new RGBELoader().loadAsync('/hdri/forest_floor_1K.hdr');
const envMap = pmremGenerator.fromEquirectangular(hdri).texture;
scene.environment = envMap;
scene.background = envMap; // or use a sky shader for more control

// PBR materials automatically use scene.environment for reflections
```

### Procedural Sky (Alternative to HDRI)
For more control + no download needed:

```typescript
// Three.js Sky shader
import { Sky } from 'three/examples/objects/Sky.js';

const sky = new Sky();
sky.scale.setScalar(10000);
scene.add(sky);

const skyUniforms = sky.material.uniforms;
skyUniforms['turbidity'].value = 10;    // 0-20, haze
skyUniforms['rayleigh'].value = 3;       // 0-4, blue scattering
skyUniforms['mieCoefficient'].value = 0.005;
skyUniforms['mieDirectionalG'].value = 0.8;
skyUniforms['sunPosition'].value.copy(sunPosition);
```

**Recommendation:** Use procedural Sky for daytime (full control, no downloads), HDRI for night/sunset (complex lighting hard to proceduralize).

## Day/Night Cycle

### Approach: Time-of-day parameter (0-24)
Driven by seed or user-controllable slider.

```typescript
interface TimeOfDay {
  hour: number;          // 0-24
  sunAngle: number;      // 0 = midnight, 0.5 = noon
  sunColor: [r, g, b];
  sunIntensity: number;
  ambientColor: [r, g, b];
  ambientIntensity: number;
  fogColor: [r, g, b];
  fogNear: number;
  fogFar: number;
  skyTurbidity: number;
  skyRayleigh: number;
}
```

### Time Keyframes (interpolate between these)

| Time | Sun Color | Sun Int. | Ambient Color | Ambient Int. | Fog |
|------|-----------|----------|---------------|-------------|-----|
| **6:00 Dawn** | (1.0, 0.6, 0.3) orange | 0.3 | (0.4, 0.3, 0.5) purple | 0.2 | Light pink |
| **9:00 Morning** | (1.0, 0.95, 0.8) warm | 1.2 | (0.5, 0.55, 0.6) blue | 0.5 | Light blue |
| **12:00 Noon** | (1.0, 1.0, 0.95) white | 1.5 | (0.6, 0.65, 0.7) blue | 0.6 | Very light |
| **16:00 Afternoon** | (1.0, 0.9, 0.7) warm | 1.0 | (0.5, 0.55, 0.6) blue | 0.5 | Light blue |
| **18:30 Sunset** | (1.0, 0.4, 0.1) deep orange | 0.5 | (0.4, 0.25, 0.3) pink | 0.3 | Orange haze |
| **20:00 Dusk** | (0.3, 0.2, 0.5) blue | 0.1 | (0.15, 0.15, 0.25) dark blue | 0.15 | Dark blue |
| **22:00 Night** | (0.2, 0.2, 0.3) moonlight | 0.05 | (0.05, 0.05, 0.1) dark | 0.05 | Very dark |
| **4:00 Pre-dawn** | (0.15, 0.15, 0.25) | 0.03 | (0.05, 0.05, 0.08) | 0.03 | Near black |

### Implementation
```typescript
function setTimeOfDay(hour: number) {
  // Interpolate between keyframes
  const keys = timeKeyframes; // sorted by hour
  const a = keys.findLast(k => k.hour <= hour) || keys[keys.length-1];
  const b = keys.find(k => k.hour > hour) || keys[0];
  const t = (hour - a.hour) / (b.hour - a.hour);
  
  sunLight.color.lerpColors(new Color(...a.sunColor), new Color(...b.sunColor), t);
  sunLight.intensity = lerp(a.sunIntensity, b.sunIntensity, t);
  ambientLight.color.lerpColors(...);
  ambientLight.intensity = lerp(a.ambientIntensity, b.ambientIntensity, t);
  
  // Update sky shader
  skyUniforms['sunPosition'].value.set(
    Math.cos(hour * Math.PI / 12) * 1000,
    Math.sin(hour * Math.PI / 12) * 1000,
    0
  );
  
  // Update fog
  scene.fog.color.setRGB(...lerpColor(a.fogColor, b.fogColor, t));
  scene.fog.near = lerp(a.fogNear, b.fogNear, t);
  scene.fog.far = lerp(a.fogFar, b.fogFar, t);
}
```

### Night-Specific Effects
- **Headlights** — SpotLight on car, narrow cone, white/yellow
- **Street lights** — Already have light objects in scenery, add PointLight to each
- **Moon** — Dim DirectionalLight opposite sun
- **Stars** — Points geometry with random positions on a large sphere
- **Emissive materials** — Road markings glow slightly at night

## Weather System

### Weather Types
```typescript
type WeatherType = 'clear' | 'cloudy' | 'rain' | 'heavy_rain' | 'fog' | 'snow';
```

### 1. Rain
```typescript
// Particle system — GPU-based points
const rainCount = 15000; // adjust by weather intensity
const rainGeo = new THREE.BufferGeometry();
const rainPositions = new Float32Array(rainCount * 3);
const rainVelocities = new Float32Array(rainCount);

for (let i = 0; i < rainCount; i++) {
  rainPositions[i*3] = (Math.random() - 0.5) * 400;   // x spread
  rainPositions[i*3+1] = Math.random() * 200;          // height
  rainPositions[i*3+2] = (Math.random() - 0.5) * 400;  // z spread
  rainVelocities[i] = 0.5 + Math.random() * 1.5;       // fall speed
}

// Update in animation loop
function updateRain(delta: number) {
  const pos = rainGeo.attributes.position;
  for (let i = 0; i < rainCount; i++) {
    pos.array[i*3+1] -= rainVelocities[i] * delta * 60;
    if (pos.array[i*3+1] < 0) pos.array[i*3+1] = 200;
  }
  pos.needsUpdate = true;
}
```

**Rain effects on world:**
- Wet road (swap to `Asphalt025C` wet texture, increase roughness to 0.1)
- Puddle reflections on road (planar reflection or simple specular boost)
- Reduced visibility (increase fog density, darken ambient)
- Raindrop sound (Web Audio loop)

### 2. Snow
Similar particle system but:
- Slower fall speed (0.1-0.3)
- Horizontal drift (sinusoidal based on time + position)
- Larger particles (PointsMaterial with larger size)
- Accumulation: gradually blend terrain color toward white (shader uniform)
- Reduced traction (physics: lower friction coefficient)

### 3. Fog
- Increase fog near/far dramatically
- Desaturate all colors (shader uniform)
- Mute ambient/directional light
- Fog color matches biome base color

### 4. Cloudy
- Increase turbidity on Sky shader (2 → 15)
- Reduce sun intensity (30-50%)
- Slightly desaturate colors
- Transition to overcast HDRI if using HDRIs

### Weather Transitions
```typescript
// Smooth transitions between weather states
interface WeatherState {
  type: WeatherType;
  intensity: number;     // 0.0-1.0
  transitionTime: number; // seconds to blend
}

// Crossfade rain particles (alpha), fog density, sky parameters
// Use lerp on all values over transitionTime
```

## Combined: Biome + Time + Weather

The final visual is the product of three layers:

```
Final Look = biome_config × time_of_day × weather_state
```

Example combinations:
- **Desert + Noon + Clear** = Harsh shadows, bright, orange haze, no fog
- **Alpine + Night + Snow** = Dark blue, heavy snowfall, moon reflections
- **Forest + Sunset + Rain** = Dark warm tones, rain particles, wet road, golden fog
- **Tropical + Morning + Fog** = Bright green, dense fog, soft light, humid feel

## Audio per Weather
| Weather | Sound |
|---------|-------|
| Clear | Birds (forest), wind (desert), crickets (night) |
| Rain | Rain loop (vary intensity), thunder (heavy rain) |
| Snow | Wind howl, muffled ambient |
| Fog | Muffled ambient, distant sounds reduced |

## Implementation Priority
1. **Procedural Sky** — immediate visual upgrade, no downloads needed
2. **Day/night cycle** — sun position + color + fog keyframes
3. **Night mode** — headlights, street lights, stars, moon
4. **Rain** — particle system + wet road texture swap
5. **Fog** — adjust existing fog parameters
6. **Snow** — particles + accumulation + drift
7. **HDRI** — download polyhaven HDRIs for night/sunset realism
8. **Weather audio** — Web Audio loops
