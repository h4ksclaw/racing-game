import { describe, expect, it } from "vitest";
import { getAllBiomes, getBiomeByName, getBiomeForSeed } from "../client/biomes.ts";

describe("biomes", () => {
	const allBiomes = getAllBiomes();

	it("has at least 4 biomes", () => {
		expect(allBiomes.length).toBeGreaterThanOrEqual(4);
	});

	it("each biome has required fields", () => {
		for (const b of allBiomes) {
			expect(b.name).toBeTruthy();
			expect(typeof b.name).toBe("string");
			expect(b.roadTint).toHaveLength(3);
			expect(b.grassTint).toHaveLength(3);
			expect(b.dirtTint).toHaveLength(3);
			expect(b.rockTint).toHaveLength(3);
			expect(b.roadRoughnessBase).toBeGreaterThan(0);
			expect(b.treeDensity).toBeGreaterThanOrEqual(0);
			expect(b.grassDensity).toBeGreaterThanOrEqual(0);
			expect(b.fogNear).toBeLessThan(b.fogFar);
			expect(b.treeTypes.length).toBeGreaterThan(0);
		}
	});

	describe("getBiomeForSeed", () => {
		it("returns a biome for any positive seed", () => {
			for (const seed of [0, 1, 42, 99999, 100000]) {
				const biome = getBiomeForSeed(seed);
				expect(biome).toBeDefined();
				expect(biome.name).toBeTruthy();
			}
		});

		it("is deterministic", () => {
			for (const seed of [0, 42, 999]) {
				expect(getBiomeForSeed(seed).name).toBe(getBiomeForSeed(seed).name);
			}
		});

		it("cycles through biomes", () => {
			const names = new Set<string>();
			for (let seed = 0; seed < allBiomes.length * 2; seed++) {
				names.add(getBiomeForSeed(seed).name);
			}
			expect(names.size).toBeGreaterThanOrEqual(allBiomes.length);
		});
	});

	describe("getBiomeByName", () => {
		it("finds existing biomes", () => {
			for (const b of allBiomes) {
				expect(getBiomeByName(b.name)).toBeDefined();
			}
		});

		it("returns undefined for non-existent biome", () => {
			expect(getBiomeByName("nonexistent")).toBeUndefined();
		});
	});
});
