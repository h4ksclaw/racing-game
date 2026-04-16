/**
 * TerrainHandler — terrain height, surface tilt, road boundary queries.
 *
 * Extracted from VehiclePhysics.update() to reduce its complexity.
 * VehiclePhysics calls sample() each frame and applies the results.
 */

import type { RoadBoundaryInfo, TerrainProvider } from "../types.ts";

export interface TerrainSample {
	groundY: number;
	normal?: { x: number; y: number; z: number };
	pitch: number;
	roll: number;
	roadBoundary?: RoadBoundaryInfo;
}

export class TerrainHandler {
	private terrain: TerrainProvider | null = null;

	setTerrain(terrain: TerrainProvider): void {
		this.terrain = terrain;
	}

	sample(x: number, z: number, heading: number): TerrainSample | null {
		if (!this.terrain) return null;

		const groundY = this.terrain.getHeight(x, z);
		const sh = Math.sin(heading);
		const ch = Math.cos(heading);

		const result: TerrainSample = { groundY, pitch: 0, roll: 0 };

		if (this.terrain.getNormal) {
			const normal = this.terrain.getNormal(x, z);
			if (normal) {
				result.normal = normal;
				const fwdSlope = -(normal.x * sh + normal.z * ch);
				const rightSlope = -(normal.x * ch - normal.z * sh);
				result.pitch = Math.atan2(fwdSlope, normal.y);
				result.roll = Math.atan2(rightSlope, normal.y);
			}
		}

		if (this.terrain.getRoadBoundary) {
			result.roadBoundary = this.terrain.getRoadBoundary(x, z);
		}

		return result;
	}
}
