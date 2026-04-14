// Simulate the terrain shader blend weights
// This replicates the GLSL logic in TypeScript

function hash2(x: number, y: number): number {
  return ((Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1 + 1) % 1;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix+1, iy);
  const c = hash2(ix, iy+1), d = hash2(ix+1, iy+1);
  return (a*(1-sx)+b*sx)*(1-sy) + (c*(1-sx)+d*sx)*sy;
}

function fbm(x: number, y: number): number {
  let v = 0, a = 0.5;
  for (let i = 0; i < 5; i++) { v += a * valueNoise(x, y); x *= 2.03; y *= 2.03; a *= 0.5; }
  return v;
}

function voronoi(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  let minDist = 1;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = dx + (hash2(ix+dx, iy+dy) * 0.8 + 0.1);
    const ny = dy + (hash2(ix+dx+57.1, iy+dy+93.3) * 0.8 + 0.1);
    const d = Math.sqrt((nx-fx)**2 + (ny-fy)**2);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function voronoiFbm(x: number, y: number): number {
  return voronoi(x, y) * 0.5 + voronoi(x*1.7+3.7, y*1.7+3.7) * 0.3 + voronoi(x*3.1+7.3, y*3.1+7.3) * 0.2;
}

// Alpine defaults
const snowThreshold = 40, rockThreshold = 0.5;
const mossRange = 25, dirtNearDist = 0, dirtFarDist = -10;
const farDirtStart = 40, farDirtEnd = 80;
const patchNoiseStrength = 0.7;

function computeWeights(slope: number, aboveRoad: number, dist: number, wx: number, wz: number) {
  const voroLarge = voronoiFbm(wx * 0.008);
  const voroSmall = voronoiFbm(wx * 0.025 + wz * 0.015);
  const fbmLarge = fbm(wx * 0.006, wz * 0.006);
  const fbmSmall = fbm(wx * 0.02, wz * 0.02);
  const terrainNoise = fbmLarge * 0.4 + voroLarge * 0.35 + voroSmall * 0.15 + fbmSmall * 0.1;
  
  const slopeBias = Math.max(0, Math.min(1, (slope - 0) / 0.3));
  const lowBias = Math.max(0, Math.min(1, (5 - aboveRoad) / 15));
  const distBias = Math.max(0, Math.min(1, (dist - 10) / 40)) * 0.3;
  
  let wRock = Math.max(0, Math.min(1, (slope - rockThreshold) / 0.15));
  wRock = Math.max(wRock, Math.max(0, Math.min(1, (terrainNoise - 0.55) / 0.15)) * slopeBias * 0.5);
  
  const wSnowRaw = Math.max(0, Math.min(1, (aboveRoad - snowThreshold) / 15));
  const snowBreakup = Math.max(0, Math.min(1, (terrainNoise - 0.3) / 0.4));
  const heightFactor = Math.max(0, Math.min(1, (aboveRoad - snowThreshold) / 60));
  let wSnow = wSnowRaw * (snowBreakup * (1 - heightFactor) + heightFactor);
  
  const wNearMoss = Math.max(0, Math.min(1, (mossRange - dist) / mossRange)) * (0.5 + 0.5 * valueNoise(wx*0.1, wz*0.1));
  const wBelowDirt = Math.max(0, Math.min(1, (dirtNearDist - aboveRoad) / (dirtFarDist - dirtNearDist)));
  const slopeBreak = Math.max(0, Math.min(1, (slope - 0.35) / 0.2)) * (1 - heightFactor * 0.5);
  wSnow *= (1 - slopeBreak * 0.7);
  wRock = Math.max(wRock, slopeBreak * 0.5);
  
  const wFarDirt = Math.max(0, Math.min(1, (dist - farDirtStart) / (farDirtEnd - farDirtStart))) * (1 - patchNoiseStrength + patchNoiseStrength * terrainNoise);
  
  let wGrass = 1.0;
  const patchThreshold = 0.5 + slopeBias * 0.15 + lowBias * 0.1 + distBias;
  const wGrassPatch = Math.max(0, Math.min(1, (terrainNoise - patchThreshold) / 0.15)) * 0.35;
  
  wGrass -= wRock; wGrass -= wSnow; wGrass -= wNearMoss; wGrass -= wBelowDirt; wGrass -= wFarDirt; wGrass -= wGrassPatch;
  wGrass = Math.max(wGrass, 0);
  
  const total = wGrass + wRock + wSnow + wNearMoss + wBelowDirt + wFarDirt + wGrassPatch;
  return {
    grass: wGrass/total, rock: wRock/total, snow: wSnow/total,
    moss: wNearMoss/total, belowDirt: wBelowDirt/total, farDirt: wFarDirt/total,
    grassPatch: wGrassPatch/total, total, terrainNoise
  };
}

// Sample a grid of positions
console.log("=== ALPINE BLEND WEIGHTS (simulated) ===");
console.log("Format: slope, aboveRoad, dist → grass/rock/snow/moss/belowDirt/farDirt/patch\n");

// Near road, low terrain
for (const [slope, ar, dist] of [
  [0.05, 5, 15],   // near road, slightly above
  [0.05, 20, 30],  // moderate height, near-mid
  [0.05, 40, 50],  // AT snow threshold
  [0.05, 60, 60],  // above snow threshold
  [0.05, 80, 70],  // well above
  [0.05, 100, 80], // high up
  [0.1, 50, 50],   // moderate slope, mid height
  [0.3, 50, 50],   // steep slope, mid height
  [0.05, -5, 20],  // below road
  [0.05, 30, 100], // far from road, moderate height
  [0.05, 50, 100], // far from road, at snow threshold
  [0.05, 70, 100], // far from road, above snow
]) {
  // Sample at a few world positions
  let totalGrass=0, totalRock=0, totalSnow=0;
  const samples = 5;
  for (let s = 0; s < samples; s++) {
    const wx = s * 37.7 + 10;
    const wz = s * 53.3 + 20;
    const w = computeWeights(slope, ar, dist, wx, wz);
    totalGrass += w.grass; totalRock += w.rock; totalSnow += w.snow;
  }
  console.log(`slope=${slope} ar=${ar} dist=${dist} → grass=${(totalGrass/samples*100).toFixed(0)}% rock=${(totalRock/samples*100).toFixed(0)}% snow=${(totalSnow/samples*100).toFixed(0)}%`);
}
