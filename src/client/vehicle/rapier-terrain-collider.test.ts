import { describe, expect, it } from "vitest";
import { buildTerrainTrimesh, TERRAIN_PATCH } from "./rapier-terrain-collider.ts";
import type { TerrainProvider } from "./types.ts";

class GridTerrain implements TerrainProvider {
	constructor(
		private baseHeight = 0,
		private slopeX = 0,
		private slopeZ = 0,
	) {}

	getHeight(x: number, z: number): number {
		return this.baseHeight + this.slopeX * x + this.slopeZ * z;
	}
}

describe("buildTerrainTrimesh", () => {
	it("produces correct number of vertices for a flat terrain", () => {
		const terrain = new GridTerrain(5);
		const size = 10;
		const resolution = 2;
		const { vertices, indices } = buildTerrainTrimesh(terrain, 0, 0, size, resolution);

		// 10/2 = 5 cells → 6 vertices per axis → 36 vertices
		const expectedVerts = 6 * 6;
		expect(vertices.length / 3).toBe(expectedVerts);

		// 5×5 cells → 2 triangles each → 150 indices
		const expectedIndices = 5 * 5 * 6;
		expect(indices.length).toBe(expectedIndices);
	});

	it("produces correct number of vertices at default patch size", () => {
		const terrain = new GridTerrain(0);
		const { vertices, indices } = buildTerrainTrimesh(terrain, 0, 0, TERRAIN_PATCH.SIZE, TERRAIN_PATCH.RESOLUTION);

		const cols = Math.ceil(TERRAIN_PATCH.SIZE / TERRAIN_PATCH.RESOLUTION);
		expect(vertices.length / 3).toBe((cols + 1) * (cols + 1));
		expect(indices.length).toBe(cols * cols * 6);
	});

	it("all vertices have the height offset applied", () => {
		const terrain = new GridTerrain(10);
		const { vertices } = buildTerrainTrimesh(terrain, 0, 0, 10, 2);

		// Every vertex should have Y = 10 + TERRAIN_PATCH.HEIGHT_OFFSET
		const expectedY = 10 + TERRAIN_PATCH.HEIGHT_OFFSET;
		for (let i = 0; i < vertices.length / 3; i++) {
			expect(vertices[i * 3 + 1]).toBeCloseTo(expectedY, 5);
		}
	});

	it("vertices span the correct XZ range centered on origin", () => {
		const terrain = new GridTerrain(0);
		const size = 20;
		const resolution = 5;
		const { vertices } = buildTerrainTrimesh(terrain, 0, 0, size, resolution);

		// Should span from -10 to +10 in both X and Z
		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let minZ = Number.POSITIVE_INFINITY;
		let maxZ = Number.NEGATIVE_INFINITY;

		for (let i = 0; i < vertices.length / 3; i++) {
			const x = vertices[i * 3];
			const z = vertices[i * 3 + 2];
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minZ = Math.min(minZ, z);
			maxZ = Math.max(maxZ, z);
		}

		expect(minX).toBeCloseTo(-size / 2, 5);
		expect(maxX).toBeCloseTo(size / 2, 5);
		expect(minZ).toBeCloseTo(-size / 2, 5);
		expect(maxZ).toBeCloseTo(size / 2, 5);
	});

	it("vertices are offset when center is non-zero", () => {
		const terrain = new GridTerrain(0);
		const { vertices } = buildTerrainTrimesh(terrain, 50, 100, 20, 10);

		// Should span from 40 to 60 in X, 90 to 110 in Z
		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let minZ = Number.POSITIVE_INFINITY;
		let maxZ = Number.NEGATIVE_INFINITY;

		for (let i = 0; i < vertices.length / 3; i++) {
			const x = vertices[i * 3];
			const z = vertices[i * 3 + 2];
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minZ = Math.min(minZ, z);
			maxZ = Math.max(maxZ, z);
		}

		expect(minX).toBeCloseTo(40, 5);
		expect(maxX).toBeCloseTo(60, 5);
		expect(minZ).toBeCloseTo(90, 5);
		expect(maxZ).toBeCloseTo(110, 5);
	});

	it("indices form valid triangles (no out-of-bounds)", () => {
		const terrain = new GridTerrain(0);
		const { vertices, indices } = buildTerrainTrimesh(terrain, 0, 0, 10, 2);
		const maxVertexIndex = vertices.length / 3 - 1;

		for (let i = 0; i < indices.length; i++) {
			expect(indices[i]).toBeGreaterThanOrEqual(0);
			expect(indices[i]).toBeLessThanOrEqual(maxVertexIndex);
		}
	});

	it("sloped terrain produces varying heights", () => {
		const terrain = new GridTerrain(0, 1, 0); // Y = X
		const { vertices } = buildTerrainTrimesh(terrain, 0, 0, 10, 2);

		let minY = Number.POSITIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;

		for (let i = 0; i < vertices.length / 3; i++) {
			const y = vertices[i * 3 + 1];
			minY = Math.min(minY, y);
			maxY = Math.max(maxY, y);
		}

		// Y values should vary (slope)
		expect(maxY).toBeGreaterThan(minY);
		// The offset is added uniformly
		expect(minY).toBeCloseTo(-5 + TERRAIN_PATCH.HEIGHT_OFFSET, 3);
		expect(maxY).toBeCloseTo(5 + TERRAIN_PATCH.HEIGHT_OFFSET, 3);
	});

	it("returns Float32Array and Uint32Array", () => {
		const terrain = new GridTerrain(0);
		const { vertices, indices } = buildTerrainTrimesh(terrain, 0, 0, 10, 2);

		expect(vertices).toBeInstanceOf(Float32Array);
		expect(indices).toBeInstanceOf(Uint32Array);
	});
});

describe("TERRAIN_PATCH constants", () => {
	it("has sensible defaults", () => {
		expect(TERRAIN_PATCH.SIZE).toBe(200);
		expect(TERRAIN_PATCH.RESOLUTION).toBeGreaterThan(0);
		expect(TERRAIN_PATCH.REBUILD_DIST).toBe(60);
		expect(TERRAIN_PATCH.EDGE_MARGIN).toBe(30);
		expect(TERRAIN_PATCH.HEIGHT_OFFSET).toBe(0.3);
	});

	it("REBUILD_DIST is less than half SIZE", () => {
		// Must be able to rebuild before car exits patch
		expect(TERRAIN_PATCH.REBUILD_DIST).toBeLessThan(TERRAIN_PATCH.SIZE / 2);
	});

	it("EDGE_MARGIN is positive", () => {
		expect(TERRAIN_PATCH.EDGE_MARGIN).toBeGreaterThan(0);
	});
});
