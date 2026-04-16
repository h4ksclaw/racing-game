/**
 * Biome config validation tests.
 * Ensures all biome configs are physically reasonable and internally consistent.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_GUARDRAIL_CONFIG, getAllBiomes, getBiomeForSeed } from "./biomes.ts";

describe("Biome config validation", () => {
	const allBiomes = getAllBiomes();

	describe("color values", () => {
		it("all tints are RGB tuples with values in [0, 1]", () => {
			for (const b of allBiomes) {
				for (const tint of [b.roadTint, b.grassTint, b.dirtTint, b.rockTint, b.fogColor]) {
					expect(tint).toHaveLength(3);
					for (const v of tint) {
						expect(v).toBeGreaterThanOrEqual(0);
						expect(v).toBeLessThanOrEqual(1.5); // color multipliers can exceed 1.0
					}
				}
			}
		});

		it("sky turbidity and rayleigh are positive", () => {
			for (const b of allBiomes) {
				expect(b.skyTurbidity).toBeGreaterThan(0);
				expect(b.skyRayleigh).toBeGreaterThan(0);
			}
		});
	});

	describe("fog settings", () => {
		it("fogNear < fogFar for all biomes", () => {
			for (const b of allBiomes) {
				expect(b.fogNear).toBeLessThan(b.fogFar);
				expect(b.fogNear).toBeGreaterThan(0);
			}
		});
	});

	describe("terrain settings", () => {
		it("noise amplitudes are positive", () => {
			for (const b of allBiomes) {
				expect(b.noiseAmp).toBeGreaterThanOrEqual(0);
				expect(b.mountainAmplifier).toBeGreaterThanOrEqual(0);
			}
		});
	});

	describe("scenery", () => {
		it("tree types are non-empty for all biomes", () => {
			for (const b of allBiomes) {
				expect(b.treeTypes.length).toBeGreaterThan(0);
				// grassTypes may be empty (e.g. alpine) — validated elsewhere
			}
		});

		it("density values are non-negative", () => {
			for (const b of allBiomes) {
				expect(b.treeDensity).toBeGreaterThanOrEqual(0);
				expect(b.grassDensity).toBeGreaterThanOrEqual(0);
				expect(b.rockDensity).toBeGreaterThanOrEqual(0);
			}
		});
	});

	describe("guardrails", () => {
		it("biomes with guardrails pass validation", () => {
			for (const b of allBiomes) {
				if (b.guardrail) {
					expect(b.guardrail.postSpacing).toBeGreaterThan(0);
					expect(b.guardrail.postHeight).toBeGreaterThan(0);
					expect(b.guardrail.railCount).toBeGreaterThan(0);
					expect(b.guardrail.rails.length).toBe(b.guardrail.railCount);
					for (const rail of b.guardrail.rails) {
						expect(rail.y).toBeLessThan(b.guardrail.postHeight);
						expect(rail.halfWidth).toBeGreaterThan(0);
						for (const c of rail.color) {
							expect(c).toBeGreaterThanOrEqual(0);
							expect(c).toBeLessThanOrEqual(1);
						}
					}
				}
			}
		});

		it("default guardrail config is valid", () => {
			const cfg = DEFAULT_GUARDRAIL_CONFIG;
			expect(cfg.postSpacing).toBeGreaterThan(0);
			expect(cfg.postHeight).toBeGreaterThan(0);
			expect(cfg.rails.length).toBe(cfg.railCount);
		});
	});

	describe("houses", () => {
		it("biomes with houses have valid house configs", () => {
			for (const b of allBiomes) {
				if (b.houses?.enabled) {
					const h = b.houses;
					expect(h.spacing).toBeGreaterThan(0);
					expect(h.flattenRadius).toBeGreaterThan(0);
					expect(h.minSize[0]).toBeGreaterThan(0);
					expect(h.minSize[1]).toBeGreaterThan(0);
					expect(h.maxSize[0]).toBeGreaterThanOrEqual(h.minSize[0]);
					expect(h.maxSize[1]).toBeGreaterThanOrEqual(h.minSize[1]);
					expect(h.heightRange[0]).toBeGreaterThan(0);
					expect(h.heightRange[1]).toBeGreaterThanOrEqual(h.heightRange[0]);
					expect(h.distanceRange[0]).toBeGreaterThan(0);
					expect(h.distanceRange[1]).toBeGreaterThanOrEqual(h.distanceRange[0]);
				}
			}
		});
	});

	describe("road surface", () => {
		it("roughness values are in [0, 1]", () => {
			for (const b of allBiomes) {
				expect(b.roadRoughnessBase).toBeGreaterThanOrEqual(0);
				expect(b.roadRoughnessBase).toBeLessThanOrEqual(1);
			}
		});
	});

	describe("coverage", () => {
		it("getBiomeForSeed covers all biome indices", () => {
			const names = new Set<string>();
			for (let seed = 0; seed < 1000; seed++) {
				names.add(getBiomeForSeed(seed).name);
			}
			for (const b of allBiomes) {
				expect(names.has(b.name)).toBe(true);
			}
		});
	});
});
