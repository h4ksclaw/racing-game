import { getAllBiomes } from '../src/client/biomes.ts';
const biomes = getAllBiomes();
const alpine = biomes[3];
console.log("=== ALPINE MEADOW BIOME CONFIG ===");
console.log("snowThreshold:", alpine.snowThreshold);
console.log("rockThreshold:", alpine.rockThreshold);
console.log("mossRange:", alpine.mossRange);
console.log("dirtNearDist:", alpine.dirtNearDist);
console.log("dirtFarDist:", alpine.dirtFarDist);
console.log("farDirtStart:", alpine.farDirtStart);
console.log("farDirtEnd:", alpine.farDirtEnd);
console.log("patchNoiseStrength:", alpine.patchNoiseStrength);
console.log("snowTint:", alpine.snowTint);
console.log("");
console.log("=== ALL BIOME PER-BIOME OVERRIDES ===");
for (let i = 0; i < biomes.length; i++) {
  const b = biomes[i];
  const overrides = [];
  if (b.mossRange !== undefined) overrides.push(`mossRange=${b.mossRange}`);
  if (b.dirtNearDist !== undefined) overrides.push(`dirtNearDist=${b.dirtNearDist}`);
  if (b.dirtFarDist !== undefined) overrides.push(`dirtFarDist=${b.dirtFarDist}`);
  if (b.farDirtStart !== undefined) overrides.push(`farDirtStart=${b.farDirtStart}`);
  if (b.farDirtEnd !== undefined) overrides.push(`farDirtEnd=${b.farDirtEnd}`);
  if (b.patchNoiseStrength !== undefined) overrides.push(`patchNoiseStrength=${b.patchNoiseStrength}`);
  console.log(`${i}: ${b.name}: ${overrides.length ? overrides.join(', ') : '(all defaults)'}`);
}
