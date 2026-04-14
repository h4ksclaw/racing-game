import { createNoise2D } from "simplex-noise";
import { generateTrack } from "./src/shared/track.ts";
import { mulberry32 } from "./src/shared/track.ts";

function smoothstep(edge0: number, edge1: number, x: number) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

const seed = 53981;
const rng = mulberry32(seed);
const noise2D = createNoise2D(rng);
const { samples } = generateTrack(seed);

function nearestRoad(x: number, z: number) {
    let best = { dist: Infinity, sample: samples[0] };
    for (const s of samples) {
        const dx = x - s.point.x;
        const dz = z - s.point.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < best.dist) best = { dist: d, sample: s };
    }
    return best;
}

const fbm = (x: number, z: number) => {
    let v = 0, a = 1, f = 1, max = 0;
    for (let i = 0; i < 6; i++) { v += a * noise2D(x * f, z * f); max += a; a *= 0.5; f *= 2.03; }
    return v / max;
};

const snowThreshold = 70;
const rockThreshold = 0.5;
const worldRadius = 800;
const noiseAmp = 60;
const mountainAmp = 3;
const blendStart = 15;
const roadInfluence = 40;

let sumG=0,sumR=0,sumS=0,sumM=0,sumBD=0,sumFD=0,n=0;
let maxR=0,maxS=0,maxM=0,maxFD=0,maxBD=0;
const nonGrassPoints: any[] = [];

for (let x = -600; x <= 600; x += 30) {
    for (let z = -600; z <= 600; z += 30) {
        const { dist, sample } = nearestRoad(x, z);
        const centerDist = Math.sqrt(x * x + z * z);
        const mountainFactor = 1 + smoothstep(worldRadius * 0.75, worldRadius, centerDist) * mountainAmp;
        const noiseH = fbm(x * 0.003, z * 0.003) * noiseAmp * mountainFactor;
        const blend = smoothstep(blendStart, roadInfluence, dist);
        const blendedY = sample.point.y * (1 - blend) + (sample.point.y + noiseH) * blend;
        const h = Math.max(sample.point.y - dist * 0.4, Math.min(sample.point.y + dist * 0.4, blendedY)) - 0.3;
        const realAbove = h - sample.point.y;
        
        const { sample: s1 } = nearestRoad(x + 2, z);
        const { sample: s2 } = nearestRoad(x, z + 2);
        const slope = Math.sqrt((s1.point.y - sample.point.y)**2 + (s2.point.y - sample.point.y)**2);
        
        const noise1 = Math.sin(x * 0.05 + z * 0.07) * 0.5 + 0.5;
        const nx = x * 0.02, nz = z * 0.02;
        const noise2 = (Math.sin(nx * 1.7 + nz * 2.3) * 0.5 + 0.5) * 0.5 +
            (Math.sin(nx * 5.1 + nz * 3.7 + 1.3) * 0.5 + 0.5) * 0.3 +
            (Math.sin(nx * 11.3 + nz * 9.1 + 4.7) * 0.5 + 0.5) * 0.2;
        
        const nearRoad = smoothstep(25.0, 0.0, dist);
        
        let wRock = smoothstep(rockThreshold, rockThreshold + 0.15, slope);
        let wSnowRaw = smoothstep(snowThreshold, snowThreshold + 15.0, realAbove);
        let snowBreakup = smoothstep(0.3, 0.7, noise2);
        let heightFactor = smoothstep(snowThreshold, snowThreshold + 60.0, realAbove);
        let wSnow = wSnowRaw * Math.min(1, snowBreakup + (1 - snowBreakup) * heightFactor);
        let wNearMoss = smoothstep(0.0, 1.0, nearRoad) * (0.5 + 0.5 * noise1);
        let wBelowDirt = smoothstep(0.0, -10.0, realAbove);
        let slopeBreak = smoothstep(0.35, 0.55, slope) * (1.0 - heightFactor * 0.5);
        wSnow *= (1.0 - slopeBreak * 0.7);
        wRock = Math.max(wRock, slopeBreak * 0.5);
        let wFarDirt = smoothstep(40.0, 80.0, dist) * (0.3 + 0.7 * noise2);
        
        let wGrass = 1.0 - wRock - wSnow - wNearMoss - wBelowDirt - wFarDirt;
        wGrass = Math.max(wGrass, 0.0);
        const total = wGrass + wRock + wSnow + wNearMoss + wBelowDirt + wFarDirt;
        
        if (total > 0.01) {
            const gPct = wGrass/total*100, rPct = wRock/total*100, sPct = wSnow/total*100;
            const mPct = wNearMoss/total*100, bdPct = wBelowDirt/total*100, fdPct = wFarDirt/total*100;
            sumG+=gPct; sumR+=rPct; sumS+=sPct; sumM+=mPct; sumBD+=bdPct; sumFD+=fdPct;
            n++;
            maxR=Math.max(maxR,rPct); maxS=Math.max(maxS,sPct); maxM=Math.max(maxM,mPct);
            maxFD=Math.max(maxFD,fdPct); maxBD=Math.max(maxBD,bdPct);
            
            const nonGrass = rPct + sPct + mPct + bdPct + fdPct;
            if (nonGrass > 5) {
                nonGrassPoints.push({ x, z, dist: dist.toFixed(0), G: gPct.toFixed(0), R: rPct.toFixed(0), S: sPct.toFixed(0), M: mPct.toFixed(0), BD: bdPct.toFixed(0), FD: fdPct.toFixed(0) });
            }
        }
    }
}

console.log(`=== BLEND WEIGHT ANALYSIS for seed ${seed} ===`);
console.log(`Sampled ${n} points`);
console.log(`Average weights: grass=${(sumG/n).toFixed(1)}% rock=${(sumR/n).toFixed(1)}% snow=${(sumS/n).toFixed(1)}% moss=${(sumM/n).toFixed(1)}% belowDirt=${(sumBD/n).toFixed(1)}% farDirt=${(sumFD/n).toFixed(1)}%`);
console.log(`Max single-point weights: rock=${maxR.toFixed(0)}% snow=${maxS.toFixed(0)}% moss=${maxM.toFixed(0)}% farDirt=${maxFD.toFixed(0)}% belowDirt=${maxBD.toFixed(0)}%`);
console.log(`Points with >5% non-grass: ${nonGrassPoints.length} / ${n}`);
if (nonGrassPoints.length > 0) {
    console.log(`\nSample non-grass points (first 20):`);
    for (const p of nonGrassPoints.slice(0, 20)) {
        console.log(`  (${p.x},${p.z}) dist=${p.dist}m  G=${p.G}% R=${p.R}% S=${p.S}% M=${p.M}% BD=${p.BD}% FD=${p.FD}%`);
    }
}
